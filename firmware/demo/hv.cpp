#include "hv.h"

HardwareSerial* Serial485[NUM_485] = {
    &Serial2,
    &Serial1
};

void hv_init(void)
{
  pinMode(PWM_PIN, OUTPUT);
  analogWriteFreq(200000);
  analogWriteResolution(10);
  Serial2.setTX(4);
  Serial2.setRX(5);
  Serial2.begin(2000000);
  Serial1.setTX(0);
  Serial1.setRX(1);
  Serial1.begin(2000000);
  /*for (uint32_t i = 0; i < NUM_485; ++i)
  {
    // uint32_t pin = (i << 1) + 1;
    Serial485[i].begin(2000000);
    // pinMode(pin, OUTPUT);
    // digitalWrite(pin, HIGH);
  }*/
  for (uint32_t i = 0; i < POINT_NUM; ++i)
  {
    hv_set_pin(i, FLOAT);
  }
}

void hv_set_pin(uint32_t id, uint8_t value)
{
  auto addr = id >> 6;
  auto idx = id & 0x3F;
  auto ser = Serial485[(addr >> 2) & 1];
  ser->write(0xC0 | addr);
  ser->write((value << 6) | idx);
  ser->flush();
}

void hv_set_volt(uint8_t target_volt)
{
  analogWrite(PWM_PIN, (target_volt * 194609UL) >> 16);
}
