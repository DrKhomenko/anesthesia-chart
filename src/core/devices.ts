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

export const PRESET_DEVICES: DevicePreset[] = [
  {
    id: PRESET_UMEC12_ID, type: 'monitor', name: 'Mindray uMEC12 Vet', isPreset: true,
    fieldKeys: MONITOR_FIELDS.map(f => f.key), regions: {},
  },
  {
    id: PRESET_WATO_ID, type: 'machine', name: 'Mindray WATO EX-35Vet', isPreset: true,
    fieldKeys: MACHINE_FIELDS.map(f => f.key), regions: {},
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
