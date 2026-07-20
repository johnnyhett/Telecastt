#include <windows.h>
#include <iostream>

bool InjectMouseMove(int x, int y) {
    INPUT input = {0};
    input.type = INPUT_MOUSE;
    input.mi.dx = (LONG)(x * (65535.0f / GetSystemMetrics(SM_CXSCREEN)));
    input.mi.dy = (LONG)(y * (65535.0f / GetSystemMetrics(SM_CYSCREEN)));
    input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    
    return SendInput(1, &input, sizeof(INPUT)) == 1;
}

bool InjectKeyPress(int vkCode, bool down) {
    INPUT input = {0};
    input.type = INPUT_KEYBOARD;
    input.ki.wVk = vkCode;
    input.ki.dwFlags = down ? 0 : KEYEVENTF_KEYUP;
    
    return SendInput(1, &input, sizeof(INPUT)) == 1;
}
