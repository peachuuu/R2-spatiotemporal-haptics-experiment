import { expect, test, type Page } from "@playwright/test";

/**
 * 虚拟串口端到端：真实 R2 + 游戏 + HardwareHost iframe 与 postMessage 桥，
 * 设备由注入脚本模拟（协议 v2 自动应答）。覆盖：
 *   连接 → ARM → 校准应用（真实 ACK）→ 正式条件 CUE_REQUEST →
 *   SAMPLE_UNDEFINED 暂停（可恢复）→ 允许样本后 PREPARED → START_CUE →
 *   游戏恢复 → STARTED/COMPLETE 事件 → STOP。
 * 同时断言只有宿主 iframe 触碰了 navigator.serial。
 */

test.setTimeout(300_000);

const DEVICE_SCRIPT = `(() => {
  const T = (() => { const t = new Uint16Array(256); for (let i=0;i<256;i++){let c=i<<8;for(let b=0;b<8;b++){c=(c&0x8000)?((c<<1)^0x1021)&0xffff:(c<<1)&0xffff;}t[i]=c;} return t; })();
  const crc = (bytes) => { let c=0xffff; for(const x of bytes){ c=((c<<8)^T[((c>>8)^x)&0xff])&0xffff; } return c; };
  const frame = (op, txn, payload=[]) => { const f=new Uint8Array(10+payload.length+2); f[0]=0x52;f[1]=0x32;f[2]=1;f[3]=op;
    new DataView(f.buffer).setUint32(4,txn>>>0,true); new DataView(f.buffer).setUint16(8,payload.length,true); f.set(payload,10);
    const c=crc(f.subarray(0,10+payload.length)); new DataView(f.buffer).setUint16(10+payload.length,c,true); return f; };
  const asc = (s) => Uint8Array.from([...s].map(c=>c.charCodeAt(0)));
  const le32 = (v) => new Uint8Array([v&255,(v>>8)&255,(v>>16)&255,(v>>24)&255]);
  const state = { armed:false, voltageCode:0, state:2, prepared:null, allow:new Set() };
  window.__fakeDevice = { setAllow(ids){ state.allow = new Set(ids); } };
  window.__serialTouched = false;
  Object.defineProperty(Navigator.prototype, "serial", { configurable:true, get() {
    window.__serialTouched = true;
    return { requestPort: async () => {
      const parser = { buf: new Uint8Array(0), respond: null,
        push(chunk){ const o=new Uint8Array(this.buf.length+chunk.length); o.set(this.buf,0); o.set(chunk,this.buf.length); this.buf=o;
          while(this.buf.length>=10){ const len=new DataView(this.buf.buffer,this.buf.byteOffset).getUint16(8,true); const total=10+len+2;
            if(this.buf.length<total) return; const op=this.buf[3]; const txn=new DataView(this.buf.buffer,this.buf.byteOffset).getUint32(4,true);
            const payload=this.buf.slice(10,10+len); this.buf=this.buf.subarray(total); this.respond(op,txn,payload); } } };
      const readable = new ReadableStream({ start(controller){ window.__fakeDevice.enqueue=(bytes)=>controller.enqueue(bytes); } });
      const writable = new WritableStream({ write(chunk){ parser.push(new Uint8Array(chunk)); } });
      parser.respond = (op, txn, payload) => {
        const send=(o,p=[])=>window.__fakeDevice.enqueue(frame(o,txn,p));
        switch(op){
          case 0x01: send(0x81,[0,3,1,0]); break;
          case 0x02: { const p = state.prepared ? asc(state.prepared) : []; send(0x82,[state.state, state.armed?1:0, state.voltageCode, p.length, ...p, 0]); break; }
          case 0x03: if(state.armed) send(0x8A,[0x03,...asc("already armed")]); else { state.armed=true; send(0x83); } break;
          case 0x04: state.voltageCode=payload[1]; send(0x84,[payload[0],payload[1]]); break;
          case 0x05: send(0x85,[payload[0]]); setTimeout(()=>send(0x88,[payload[0]]),250); break;
          case 0x06: { const id=String.fromCharCode(...payload);
            if(state.allow.has(id)){ state.prepared=id; send(0x86,[...asc(id),...le32(5090000)]); }
            else send(0x8A,[0x06,...asc(id)]); break; }
          case 0x07: { const delay=new DataView(payload.buffer,payload.byteOffset).getUint32(0,true);
            setTimeout(()=>{ send(0x87, le32(12345678)); }, Math.max(1,delay));
            setTimeout(()=>{ send(0x88, [...asc(state.prepared||""), ...le32(5090000)]); state.prepared=null; }, Math.max(1,delay)+600); break; }
          case 0x08: state.prepared=null; send(0x89); break;
          default: send(0x8A,[0x02,...asc("opcode")]);
        }
      };
      return { open: async ()=>{}, close: async ()=>{}, getInfo: ()=>({usbVendorId:0x2e8a,usbProductId:0x0005}), writable, readable };
    }};
  }});
})();`;

async function connectAndArm(page: Page) {
  await page.getByRole("button", { name: /硬件连接/ }).click();
  const host = page.frameLocator('iframe[data-testid="hardware-host-frame"]');
  await host.getByRole("button", { name: "选择串口并连接" }).click();
  await expect(host.getByText(/已连接（固件 v0.3 样本表 v1/)).toBeVisible({ timeout: 15_000 });
  await host.getByRole("button", { name: /ARM（解锁输出）/ }).click();
  await expect(host.getByText(/已 ARM/).first()).toBeVisible({ timeout: 15_000 });
}

async function productionSessionToCalibration(page: Page, code: string) {
  await page.goto("/");
  await page.getByLabel(/参与者编号/).fill(code);
  await page.getByLabel(/昵称/).fill("硬件测试");
  await page.getByLabel(/年龄/).fill("22");
  await page.getByLabel("男").check();
  await page.getByLabel("从未").check();
  await page.getByLabel("生产").check();
  await page.getByRole("button", { name: /继续/ }).click();
  const scroll = page.getByTestId("consent-scroll");
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.getByLabel(/我已阅读并理解/).check();
  await page.getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("heading", { name: /阈值校准/ })).toBeVisible();
}

test("production calibration applies output levels through the real acknowledged adapter", async ({ page }) => {
  await page.addInitScript(DEVICE_SCRIPT);
  await productionSessionToCalibration(page, "HW-CAL");

  await connectAndArm(page);

  const rows = page.getByTestId("calibration-row");
  await expect(rows).toHaveCount(8);
  const first = rows.nth(0);
  await first.getByLabel(/输出等级/).fill("120");
  await first.getByRole("button", { name: "确定" }).click();
  await expect(first.getByText("已应用（输出等级 120）")).toBeVisible({ timeout: 15_000 });
  // 只有宿主 iframe 触碰了 navigator.serial
  const hostFrame = page.frameLocator('iframe[data-testid="hardware-host-frame"]');
  const hostTouched = await hostFrame.locator("body").evaluate(() => (window as unknown as { __serialTouched?: boolean }).__serialTouched ?? false);
  expect(hostTouched).toBe(true);
  const mainTouched = await page.evaluate(() => (window as unknown as { __serialTouched?: boolean }).__serialTouched ?? false);
  expect(mainTouched).toBe(false);
});

test("formal condition gates cues on hardware, pauses on undefined samples and resumes after retry", async ({ page }) => {
  await page.addInitScript(DEVICE_SCRIPT);
  await productionSessionToCalibration(page, "HW-CUE");
  await connectAndArm(page);

  // 完成全部 8 行校准
  const rows = page.getByTestId("calibration-row");
  for (let i = 0; i < 8; i++) {
    await rows.nth(i).getByLabel(/输出等级/).fill("120");
    await rows.nth(i).getByRole("button", { name: "确定" }).click();
    await expect(rows.nth(i).getByText(/已应用（输出等级 120）/)).toBeVisible({ timeout: 15_000 });
  }
  await page.getByRole("button", { name: /继续/ }).click();

  // 练习完成 → 条件 A
  const practiceFrame = page.frameLocator('iframe[data-testid="practice-frame"]');
  await expect(practiceFrame.getByRole("button", { name: "完成练习并继续" })).toBeVisible({ timeout: 60_000 });
  await practiceFrame.getByRole("button", { name: "完成练习并继续" }).click();
  await expect(page.getByRole("heading", { name: /条件 A/i })).toBeVisible({ timeout: 60_000 });

  // G01 必须由玩家按 E/O 交互后才请求 cue；候选样本 sth.g01.unlock 未获准时
  // 固件返回 SAMPLE_UNDEFINED，试次暂停并保持在当前事件。
  const conditionFrame = page.frameLocator('iframe[data-testid="condition-frame"]');
  await expect(conditionFrame.getByText("打开机关，进入月萤遗迹")).toBeVisible({ timeout: 60_000 });
  await conditionFrame.locator("body").click();
  await conditionFrame.locator("body").press("E");
  // cue 失败后试次冻结在游戏内（CUE_FAILURE），父页面保持运行态不显示错误文案；
  // 游戏在自己的 alert 区块展示原因并允许就地重试。
  await expect(conditionFrame.getByRole("alert").filter({ hasText: /触觉 cue 失败：SAMPLE_UNDEFINED/ })).toBeVisible({ timeout: 60_000 });
  await expect(conditionFrame.getByRole("button", { name: "重试" })).toBeVisible();

  // 允许样本后重试：PREPARED → START_CUE → 游戏恢复
  const hostFrame = page.frameLocator('iframe[data-testid="hardware-host-frame"]');
  await hostFrame.locator("body").evaluate(() => {
    (window as unknown as { __fakeDevice: { setAllow(ids: string[]): void } }).__fakeDevice.setAllow(["sth.g01.unlock", "bh.g01.unlock"]);
  });
  await conditionFrame.getByRole("button", { name: "重试" }).click();

  await expect(page.getByText(/条件游戏进行中/)).toBeVisible({ timeout: 60_000 });
  await expect(conditionFrame.getByText("打开机关，进入月萤遗迹")).toBeVisible({ timeout: 60_000 });

  // START_CUE 后游戏恢复：按 E 开始解锁
  await conditionFrame.locator("body").click();
  await conditionFrame.locator("body").press("E");
  await expect(conditionFrame.getByText("沿机关边缘完成解锁")).toBeVisible({ timeout: 15_000 });

  // 只有宿主 iframe 触碰串口；正式游戏 iframe 从未触碰
  const hostTouched = await hostFrame.locator("body").evaluate(() => (window as unknown as { __serialTouched?: boolean }).__serialTouched ?? false);
  const gameTouched = await conditionFrame.locator("body").evaluate(() => (window as unknown as { __serialTouched?: boolean }).__serialTouched ?? false);
  expect(hostTouched).toBe(true);
  expect(gameTouched).toBe(false);

  // 逐 cue 同步日志已写入会话（IndexedDB）
  const cueLogs = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("electrotactile-study", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await new Promise<Array<{ participantCode?: string; conditionRuns?: Record<string, { attempts?: Array<{ hapticCues?: Array<{ cueKey: string; outcome: string; resolvedSampleId: string | null }> }> }> }>>((resolve, reject) => {
      const tx = db.transaction("sessions", "readonly");
      const request = tx.objectStore("sessions").getAll();
      request.onsuccess = () => resolve(request.result as never);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const session = sessions.find(s => s.participantCode === "HW-CUE");
    const attempts = Object.values(session?.conditionRuns ?? {}).flatMap(run => run.attempts ?? []);
    return attempts.flatMap(attempt => attempt.hapticCues ?? []);
  });
  // appendHapticCue 只在同 cueKey 且同 outcome 时覆盖：失败与成功记录都保留。
  expect(cueLogs.some(cue => cue.outcome === "prepare-error")).toBe(true);
  expect(cueLogs.some(cue => cue.outcome === "ok" && (cue.resolvedSampleId === "sth.g01.unlock" || cue.resolvedSampleId === "bh.g01.unlock"))).toBe(true);
});
