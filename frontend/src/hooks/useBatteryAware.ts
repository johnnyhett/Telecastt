import { useState, useEffect } from 'react';

export interface BatteryState {
  level: number;
  charging: boolean;
  shouldDegrade: boolean;
}

// The Battery Status API is not in lib.dom; describe just the surface we use.
interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
}
type BatteryCapableNavigator = Navigator & { getBattery?: () => Promise<BatteryManager> };

export const useBatteryAware = (threshold: number = 0.15): BatteryState => {
  const [state, setState] = useState<BatteryState>({ level: 1, charging: false, shouldDegrade: false });

  useEffect(() => {
    const getBattery = (navigator as BatteryCapableNavigator).getBattery;
    if (typeof getBattery !== 'function') return;

    let battery: BatteryManager | null = null;
    // The promise can resolve after unmount; don't touch state or subscribe then.
    let cancelled = false;

    const update = () => {
      if (!battery) return;
      setState({
        level: battery.level,
        charging: battery.charging,
        shouldDegrade: !battery.charging && battery.level < threshold,
      });
    };

    getBattery.call(navigator).then((b) => {
      if (cancelled) return;
      battery = b;
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    }).catch(() => { /* battery status unavailable */ });

    return () => {
      cancelled = true;
      if (battery) {
        battery.removeEventListener('levelchange', update);
        battery.removeEventListener('chargingchange', update);
      }
    };
  }, [threshold]);

  return state;
};
