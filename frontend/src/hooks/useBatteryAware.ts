import { useState, useEffect } from 'react';

export interface BatteryState {
  level: number;
  charging: boolean;
  shouldDegrade: boolean;
}

export const useBatteryAware = (threshold: number = 0.15): BatteryState => {
  const [state, setState] = useState<BatteryState>({ level: 1, charging: false, shouldDegrade: false });

  useEffect(() => {
    if (!('getBattery' in navigator)) return;

    let battery: any = null;

    const update = () => {
      if (!battery) return;
      setState({
        level: battery.level,
        charging: battery.charging,
        shouldDegrade: !battery.charging && battery.level < threshold
      });
    };

    (navigator as any).getBattery().then((b: any) => {
      battery = b;
      update();
      battery.addEventListener('levelchange', update);
      battery.addEventListener('chargingchange', update);
    });

    return () => {
      if (battery) {
        battery.removeEventListener('levelchange', update);
        battery.removeEventListener('chargingchange', update);
      }
    };
  }, [threshold]);

  return state;
};
