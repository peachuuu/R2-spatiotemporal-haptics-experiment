#ifndef __HV_H__
#define __HV_H__

#include <Arduino.h>
// #include <SoftwareSerial.h>

#define NUM_485 2
#define POINT_NUM 480UL
#define PWM_PIN 17
#define FLOAT 2

extern HardwareSerial* Serial485[NUM_485];

void hv_init(void);
void hv_set_pin(uint32_t, uint8_t);
void hv_set_volt(uint8_t);

#endif
