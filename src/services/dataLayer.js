import fs from 'fs';


if (!fs.existsSync('data/settings.json')) {
  fs.writeFileSync(
    'data/settings.json',
    JSON.stringify(
      { FunctionOnStarts: { keys: [], enabled: false }, GlobalSpeedCab: 127, swapForwardAndReverse: false }, null, 2)
  );
}

fs.mkdirSync('data/rollingstock/trains', { recursive: true });
fs.mkdirSync('data/rollingstock/wagons', { recursive: true });