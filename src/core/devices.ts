// Шаблоны приборов и справочник полей. Значения с экрана не придумываются — только ключи, подписи и рамки здравого смысла.
export type DeviceType = 'monitor' | 'machine';
export const DEVICE_TYPE_RU: Record<DeviceType, string> = {
  monitor: 'Монитор пациента',
  machine: 'Наркозный аппарат (НДА)',
};

export type FieldKind = 'number' | 'text' | 'enum';
export interface FieldRegion { x: number; y: number; w: number; h: number } // нормализованный bbox 0–1
export interface DeviceField {
  key: string;
  label: string;
  unit: string;
  kind: FieldKind;
  enumValues?: string[];
  min?: number | null;
  max?: number | null;
  aliases?: string[];
}

export const MONITOR_FIELDS: DeviceField[] = [
  { key: 'hr', label: 'ЧСС', unit: 'уд/мин', kind: 'number', min: 20, max: 400, aliases: ['HR', 'heartRate'] },
  { key: 'pr', label: 'Пульс SpO₂', unit: 'уд/мин', kind: 'number', min: 20, max: 400, aliases: ['PR', 'pulse', 'pulseRate'] },
  { key: 'spo2', label: 'SpO₂', unit: '%', kind: 'number', min: 50, max: 100, aliases: ['SpO2', 'SpO₂', 'spo2Pct'] },
  { key: 'etco2', label: 'EtCO₂', unit: 'мм рт. ст.', kind: 'number', min: 0, max: 80, aliases: ['EtCO2', 'ETCO2', 'etCO2'] },
  { key: 'fico2', label: 'FiCO₂', unit: 'мм рт. ст.', kind: 'number', min: 0, max: 20, aliases: ['FiCO2', 'FICO2'] },
  { key: 'rr', label: 'ЧДД', unit: 'в мин', kind: 'number', min: 0, max: 80, aliases: ['RR', 'respRate', 'respiratoryRate'] },
  { key: 't1', label: 'T1', unit: '°C', kind: 'number', min: 15, max: 45, aliases: ['T1', 'temp1'] },
  { key: 't2', label: 'T2', unit: '°C', kind: 'number', min: 15, max: 45, aliases: ['T2', 'temp2'] },
  { key: 'nibpSys', label: 'НИАД САД', unit: 'мм рт. ст.', kind: 'number', min: 30, max: 300, aliases: ['sys', 'SYS', 'nibpS', 'nbps'] },
  { key: 'nibpDia', label: 'НИАД ДАД', unit: 'мм рт. ст.', kind: 'number', min: 20, max: 200, aliases: ['dia', 'DIA', 'nibpD', 'nbpd'] },
  { key: 'nibpMap', label: 'НИАД МАД', unit: 'мм рт. ст.', kind: 'number', min: 20, max: 250, aliases: ['map', 'MAP', 'nibpM', 'nbpm'] },
];

export const VENT_MODES = ['PCV', 'VCV', 'SIMV', 'PS', 'PCV-VG', 'Manual'] as const;

export const MACHINE_FIELDS: DeviceField[] = [
  { key: 'ventMode', label: 'Режим', unit: '', kind: 'enum', enumValues: [...VENT_MODES], aliases: ['mode', 'Mode', 'ventilationMode'] },
  { key: 'setPinsp', label: 'Уст. Pinsp', unit: 'см вод. ст.', kind: 'number', min: 0, max: 50, aliases: ['Pinsp', 'pinsp', 'Pset'] },
  { key: 'setRr', label: 'Уст. ЧД', unit: 'в мин', kind: 'number', min: 0, max: 80, aliases: ['setRate', 'fset', 'Freq'] },
  { key: 'setIE', label: 'Уст. I:E', unit: '', kind: 'text', aliases: ['IE', 'I:E', 'ieRatio'] },
  { key: 'setTslope', label: 'Уст. Tнараст', unit: 'с', kind: 'number', min: 0, max: 2, aliases: ['Tslope', 'tslope', 'Tramp'] },
  { key: 'setPeep', label: 'Уст. PEEP', unit: 'см вод. ст.', kind: 'number', min: 0, max: 30, aliases: ['PEEPset', 'set_peep'] },
  { key: 'pPeak', label: 'Pпик', unit: 'см вод. ст.', kind: 'number', min: 0, max: 60, aliases: ['Ppeak', 'PIP', 'ppeak'] },
  { key: 'pPlat', label: 'Pплато', unit: 'см вод. ст.', kind: 'number', min: 0, max: 60, aliases: ['Pplat', 'Pplateau', 'pplat'] },
  { key: 'peep', label: 'PEEP', unit: 'см вод. ст.', kind: 'number', min: 0, max: 30, aliases: ['PEEP', 'peepMeas'] },
  { key: 'vtInsp', label: 'VT вдох', unit: 'мл', kind: 'number', min: 0, max: 2000, aliases: ['VTi', 'VTinsp', 'tidalVolumeInsp'] },
  { key: 'vtExp', label: 'VT выд', unit: 'мл', kind: 'number', min: 0, max: 2000, aliases: ['VTe', 'VTexp', 'tidalVolumeExp'] },
  { key: 'mv', label: 'МОД', unit: 'л/мин', kind: 'number', min: 0, max: 30, aliases: ['MV', 'VE', 'minuteVolume'] },
  { key: 'rrMeas', label: 'ЧД измер.', unit: 'в мин', kind: 'number', min: 0, max: 80, aliases: ['RRmeas', 'fmeas', 'measuredRr'] },
  { key: 'fio2', label: 'FiO₂', unit: '%', kind: 'number', min: 21, max: 100, aliases: ['FiO2', 'FIO2', 'fiO2'] },
  { key: 'raw', label: 'Raw', unit: 'см вод. ст./л/с', kind: 'number', min: 0, max: 200, aliases: ['Raw', 'resistance'] },
  { key: 'compliance', label: 'Compl', unit: 'мл/см вод. ст.', kind: 'number', min: 0, max: 100, aliases: ['Compl', 'Cdyn', 'compliance'] },
];

export const FIELDS_BY_TYPE: Record<DeviceType, DeviceField[]> = { monitor: MONITOR_FIELDS, machine: MACHINE_FIELDS };
export const ALL_FIELDS: DeviceField[] = [...MONITOR_FIELDS, ...MACHINE_FIELDS];
export const FIELD_BY_KEY: Record<string, DeviceField> = Object.fromEntries(ALL_FIELDS.map(f => [f.key, f]));

export const PRESET_UMEC12_ID = 'preset-umec12-vet';
export const PRESET_WATO_ID = 'preset-wato-ex-35vet';

export interface DevicePreset {
  id: string;
  type: DeviceType;
  name: string;
  fieldKeys: string[];
  regions: Record<string, FieldRegion>;
  isPreset: true;
}

/** Рамки полей относительно выровненного экрана (0–1), калибровка по фото клиники. */
export const UMEC12_REGIONS: Record<string, FieldRegion> = {
  _deviceTime: { x: 0.33, y: 0.025, w: 0.22, h: 0.07 },
  hr: { x: 0.76, y: 0.14, w: 0.18, h: 0.18 },
  spo2: { x: 0.755, y: 0.44, w: 0.11, h: 0.10 },
  pr: { x: 0.89, y: 0.44, w: 0.10, h: 0.10 },
  etco2: { x: 0.75, y: 0.63, w: 0.12, h: 0.12 },
  rr: { x: 0.90, y: 0.61, w: 0.09, h: 0.10 },
  fico2: { x: 0.90, y: 0.71, w: 0.09, h: 0.09 },
  t1: { x: 0.13, y: 0.83, w: 0.15, h: 0.07 },
  t2: { x: 0.13, y: 0.925, w: 0.12, h: 0.07 },
  nibp: { x: 0.75, y: 0.855, w: 0.18, h: 0.07 },
};

export const WATO35_REGIONS: Record<string, FieldRegion> = {
  _deviceTime: { x: 0.82, y: 0.08, w: 0.14, h: 0.08 },
  ventMode: { x: 0.245, y: 0.045, w: 0.09, h: 0.08 },
  setPinsp: { x: 0.04, y: 0.93, w: 0.08, h: 0.07 },
  setRr: { x: 0.135, y: 0.93, w: 0.08, h: 0.07 },
  setIE: { x: 0.23, y: 0.93, w: 0.08, h: 0.07 },
  setTslope: { x: 0.325, y: 0.93, w: 0.07, h: 0.07 },
  setPeep: { x: 0.415, y: 0.93, w: 0.07, h: 0.07 },
  pPeak: { x: 0.83, y: 0.22, w: 0.11, h: 0.10 },
  pPlat: { x: 0.83, y: 0.335, w: 0.11, h: 0.08 },
  peep: { x: 0.83, y: 0.435, w: 0.11, h: 0.08 },
  vtExp: { x: 0.83, y: 0.525, w: 0.10, h: 0.065 },
  mv: { x: 0.83, y: 0.595, w: 0.10, h: 0.06 },
  rrMeas: { x: 0.83, y: 0.66, w: 0.10, h: 0.06 },
  fio2: { x: 0.81, y: 0.74, w: 0.13, h: 0.10 },
  vtInsp: { x: 0.15, y: 0.555, w: 0.085, h: 0.07 },
  raw: { x: 0.34, y: 0.56, w: 0.06, h: 0.07 },
  compliance: { x: 0.34, y: 0.625, w: 0.06, h: 0.07 },
};

export const PRESET_DEVICES: DevicePreset[] = [
  {
    id: PRESET_UMEC12_ID, type: 'monitor', name: 'Mindray uMEC12 Vet', isPreset: true,
    fieldKeys: MONITOR_FIELDS.map(f => f.key), regions: { ...UMEC12_REGIONS },
  },
  {
    id: PRESET_WATO_ID, type: 'machine', name: 'Mindray WATO EX-35Vet', isPreset: true,
    fieldKeys: MACHINE_FIELDS.map(f => f.key), regions: { ...WATO35_REGIONS },
  },
];

export function fieldsFor(type: DeviceType, keys: string[]): DeviceField[] {
  const cat = FIELDS_BY_TYPE[type];
  const set = new Set(keys);
  return cat.filter(f => set.has(f.key));
}

export function fieldByKey(type: DeviceType, key: string): DeviceField | undefined {
  return FIELDS_BY_TYPE[type].find(f => f.key === key);
}
