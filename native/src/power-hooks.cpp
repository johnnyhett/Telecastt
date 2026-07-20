#include <windows.h>
#include <powrprof.h>
#include <iostream>

HPOWERNOTIFY hPowerNotify = NULL;

LRESULT CALLBACK PowerSettingCallback(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    if (uMsg == WM_POWERBROADCAST) {
        if (wParam == PBT_APMSUSPEND) {
            std::cout << "System is sleeping. Notify clients...\n";
            // Notify connected clients
        } else if (wParam == PBT_APMRESUMEAUTOMATIC) {
            std::cout << "System is waking up. Notify clients...\n";
            // Notify connected clients
        }
    }
    return DefWindowProc(hwnd, uMsg, wParam, lParam);
}

bool RegisterPowerHooks(HWND hwnd) {
    hPowerNotify = RegisterPowerSettingNotification(
        hwnd,
        &GUID_MONITOR_POWER_ON,
        DEVICE_NOTIFY_WINDOW_HANDLE
    );
    return hPowerNotify != NULL;
}

void UnregisterPowerHooks() {
    if (hPowerNotify) {
        UnregisterPowerSettingNotification(hPowerNotify);
    }
}
