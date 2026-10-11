import { t, localizeText } from './i18n';
import type { MessageKey } from './i18n';
import { lex, detectModule } from './parser';
import { parseForEditor as parseDocument } from './editor-snapshot';
import { findEntry } from './catalog';
import { versionOptions } from './versions';
// Module-scoped fallback for files without option comments. Current-file options
// take precedence, because available switches can differ between FAST versions.
const option = (key: MessageKey) => () => t(key);
const DEFINITIONS = {
  'OpenFAST:InterpOrder': {
    1: option('option.interpolation.linear'),
    2: option('option.interpolation.quadratic'),
  },
  'OpenFAST:CompElast': { 1: 'ElastoDyn', 2: option('option.structure.beamDynBlades') },
  'OpenFAST:CompInflow': {
    0: option('option.wind.stillAir'),
    1: 'InflowWind',
    2: option('option.wind.openFoam'),
  },
  'OpenFAST:CompAero': { 0: option('option.aero.disabled'), 1: 'AeroDyn v14', 2: 'AeroDyn v15' },
  'OpenFAST:CompServo': { 0: option('option.controller.disabled'), 1: 'ServoDyn' },
  'OpenFAST:CompSeaSt': { 0: option('option.seaState.disabled'), 1: 'SeaState' },
  'OpenFAST:CompHydro': { 0: option('option.hydro.disabled'), 1: 'HydroDyn' },
  'OpenFAST:CompSub': {
    0: option('option.structure.substructureDisabled'),
    1: 'SubDyn',
    2: option('option.platform.externalMckf'),
  },
  'OpenFAST:CompMooring': {
    0: option('option.mooring.disabled'),
    1: 'MAP++',
    2: 'FEAMooring',
    3: 'MoorDyn',
    4: 'OrcaFlex',
  },
  'OpenFAST:CompIce': { 0: option('option.ice.disabled'), 1: 'IceFloe', 2: 'IceDyn' },
  'OpenFAST:MHK': {
    0: option('option.turbine.wind'),
    1: option('option.turbine.fixedHydrokinetic'),
    2: option('option.turbine.floatingHydrokinetic'),
  },
  'OpenFAST:OutFileFmt': {
    1: option('option.output.text'),
    2: option('option.output.binary'),
    3: option('option.output.textAndBinary'),
  },
  'OpenFAST:TrimCase': {
    1: option('option.trim.yaw'),
    2: option('option.trim.torque'),
    3: option('option.trim.pitch'),
  },
  'OpenFAST:LinInputs': {
    0: option('option.linearization.noInputs'),
    1: option('option.linearization.standardInput'),
    2: option('option.linearization.allInputs'),
  },
  'OpenFAST:LinOutputs': {
    0: option('option.linearization.noOutputs'),
    1: option('option.output.outList'),
    2: option('option.linearization.allOutputs'),
  },
  'OpenFAST:WrVTK': {
    0: option('option.output.disabled'),
    1: option('option.output.initializationOnly'),
    2: option('option.output.animation'),
  },
  'OpenFAST:VTK_type': {
    1: option('option.mesh.surface'),
    2: option('option.mesh.basic'),
    3: option('option.mesh.all'),
  },
  'ElastoDyn:Method': {
    1: option('option.integrator.rungeKutta'),
    2: option('option.integrator.adamsBashforth'),
    3: option('option.integrator.adamsBashforthMoulton'),
  },
  'ElastoDyn:TeetMod': {
    0: option('option.teeter.noSpringDamper'),
    1: option('option.model.standard'),
    2: option('option.teeter.user'),
  },
  'ElastoDyn:YawFrctMod': {
    0: option('option.yaw.noFriction'),
    1: option('option.yaw.loadIndependentFriction'),
    2: option('option.yaw.loadDependentFriction'),
    3: option('option.model.user'),
  },
  'InflowWind:WindType': {
    1: option('option.wind.steady'),
    2: option('option.wind.uniformTimeSeries'),
    3: option('option.wind.turbSim'),
    4: option('option.wind.bladed'),
    5: option('option.wind.hawc'),
    6: option('option.wind.user'),
    7: option('option.wind.nativeBladed'),
  },
  'InflowWind:WindProfile': {
    0: option('option.wind.constantMean'),
    1: option('option.wind.logarithmicProfile'),
    2: option('option.wind.powerLawProfile'),
  },
  'InflowWind:ScaleMethod': {
    0: option('option.wind.noScaling'),
    1: option('option.wind.scalingFactor'),
    2: option('option.wind.targetDeviation'),
  },
  'HydroDyn:PotMod': {
    0: option('option.hydro.potentialFlowDisabled'),
    1: option('option.hydro.wamit'),
    2: option('option.hydro.fluidImpulseTheory'),
  },
  'HydroDyn:ExctnMod': {
    0: option('option.wave.excitationDisabled'),
    1: option('option.wave.discreteFourierTransform'),
    2: option('option.model.stateSpace'),
  },
  'HydroDyn:ExctnDisp': {
    0: option('option.hydro.undisplacedPosition'),
    1: option('option.hydro.displacedPosition'),
    2: option('option.hydro.filteredDisplacedPosition'),
  },
  'HydroDyn:PtfmYMod': {
    0: option('option.hydro.staticYaw'),
    1: option('option.hydro.filteredDynamicYaw'),
  },
  'HydroDyn:RdtnMod': {
    0: option('option.hydro.noRadiation'),
    1: option('option.hydro.timeDomainConvolution'),
    2: option('option.model.stateSpace'),
  },
  'HydroDyn:WaveDisp': {
    0: option('option.hydro.undisplacedPosition'),
    1: option('option.hydro.displacedPosition'),
  },
  'HydroDyn:DiffQTF': {
    0: option('option.hydro.differenceFrequencyDisabled'),
    10: option('option.hydro.wamit10d'),
    11: option('option.hydro.wamit11d'),
    12: option('option.hydro.wamit12d'),
  },
  'HydroDyn:SumQTF': {
    0: option('option.hydro.sumFrequencyDisabled'),
    10: option('option.hydro.wamit10s'),
    11: option('option.hydro.wamit11s'),
    12: option('option.hydro.wamit12s'),
  },
  'SeaState:WaveMod': {
    0: option('option.wave.stillWater'),
    1: option('option.wave.regular'),
    2: option('option.wave.jonswap'),
    3: option('option.wave.whiteNoise'),
    4: option('option.wave.userSpectrum'),
    5: option('option.wave.externalElevation'),
    6: option('option.wave.externalKinematics'),
  },
  'SeaState:WaveStMod': {
    0: option('option.wave.noStretching'),
    1: option('option.wave.verticalStretching'),
    2: option('option.wave.extrapolationStretching'),
    3: option('option.wave.wheelerStretching'),
  },
  'SeaState:WaveDirMod': {
    0: option('option.wave.noDirectionalSpreading'),
    1: option('option.wave.cosineDirectionalSpreading'),
  },
  'SeaState:CurrMod': {
    0: option('option.current.disabled'),
    1: option('option.current.standard'),
    2: option('option.current.user'),
  },
  'ServoDyn:PCMode': {
    0: option('option.pitch.noControl'),
    3: option('option.pitch.userController'),
    4: 'Simulink / LabVIEW',
    5: option('option.controller.bladedDll'),
  },
  'ServoDyn:VSContrl': {
    0: option('option.speed.noControl'),
    1: option('option.speed.simple'),
    3: option('option.speed.userController'),
    4: 'Simulink / LabVIEW',
    5: option('option.controller.bladedDll'),
  },
  'ServoDyn:GenModel': {
    1: option('option.generator.simpleInduction'),
    2: option('option.generator.thevenin'),
    3: option('option.generator.user'),
  },
  'ServoDyn:GenTiStr': {
    True: option('option.generator.startAtTime'),
    False: option('option.generator.startAtSpeed'),
  },
  'ServoDyn:GenTiStp': {
    True: option('option.generator.stopAtTime'),
    False: option('option.generator.stopAtZeroPower'),
  },
  'ServoDyn:HSSBrMode': {
    0: option('option.brake.disabled'),
    1: option('option.brake.simple'),
    3: option('option.brake.user'),
    4: 'Simulink / LabVIEW',
    5: option('option.controller.bladedDll'),
  },
  'ServoDyn:YCMode': {
    0: option('option.yaw.noControl'),
    3: option('option.yaw.userController'),
    4: 'Simulink / LabVIEW',
    5: option('option.controller.bladedDll'),
  },
  'ServoDyn:Ptch_Cntrl': {
    0: option('option.pitch.collective'),
    1: option('option.pitch.individual'),
  },
};
const LOOKUP = new Map(
  Object.entries(DEFINITIONS).map(([key, value]) => [key.toLowerCase(), value]),
);
function optionsFor(info) {
  const versioned = versionOptions(info.module, info.name, info.profile);
  if (versioned) {
    return versioned;
  }
  const definition = LOOKUP.get(`${info.module}:${info.name}`.toLowerCase());
  const fallback =
    definition &&
    Object.fromEntries(
      Object.entries(definition).map(([value, label]) => [
        value,
        typeof label === 'function' ? label() : label,
      ]),
    );
  const original = info.original || '';
  const strings = /\{\s*((?:"[^"]+"|'[^']+')\s*(?:,\s*(?:"[^"]+"|'[^']+')\s*)+)\}/.exec(original);
  if (strings) {
    const labels = {
      WARNING: t('option.error.warning'),
      SEVERE: t('option.error.severe'),
      FATAL: t('option.error.fatal'),
    };
    return [...strings[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map((match) => ({
      value: match[0],
      label: labels[match[1] || match[2]] || match[1] || match[2],
      source: t('option.source.fileStrings'),
    }));
  }
  const values = [];
  // Accept both {1=...,2=...} and (1=...;2=...) forms, including grouped
  // WAMIT file choices. Do not interpret inequalities as fixed choices.
  const pattern =
    /(?:^|[\s{\[(;,:])((?:[-+]?\d+|true|false|T|F)|\[\s*\d+(?:\s*,\s*(?:or\s+)?\d+)*\s*\])\s*[=:]\s*/gi;
  const matches = [...original.matchAll(pattern)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const explanation = original
      .slice(match.index + match[0].length, matches[i + 1]?.index ?? original.length)
      .split(/[}\]]/)[0]
      .replace(/[,;\s]+(?:or)?\s*$/, '')
      .trim();
    const raw = match[1].startsWith('[') ? match[1].match(/\d+/g) : [match[1]];
    for (let value of raw) {
      if (/^(?:t|true)$/i.test(value)) {
        value = 'True';
      }
      if (/^(?:f|false)$/i.test(value)) {
        value = 'False';
      }
      if (!values.some((x) => x.value === value)) {
        values.push({
          value,
          label: fallback?.[value] ? localizeText(fallback[value]) : explanation,
          original: explanation,
          source: t('option.source.fileChoices'),
        });
      }
    }
  }
  if (values.length >= 2) {
    if (/\bdefault\b/i.test(original) && !values.some((x) => x.value.toLowerCase() === 'default')) {
      values.push({
        value: /^["']/.test(info.value || '') ? '"DEFAULT"' : 'DEFAULT',
        label: t('option.programDefault'),
        source: t('option.source.fileDefault'),
      });
    }
    return values;
  }
  // A lone "0=no corrections" is a special value of an unbounded integer,
  // not a closed enumeration. In particular, never cap NumCrctn or DecFact.
  if (matches.length) {
    return [];
  }
  if (fallback) {
    return Object.entries(fallback).map(([value, label]) => ({
      value,
      label: localizeText(String(label)),
      source: t('option.source.builtIn'),
    }));
  }
  const entry = findEntry(info.name, info.module);
  const description = entry?.description || '';
  if (
    /\bflag\b|true\s*\/\s*false|是否|布尔|逻辑开关/i.test(original + ' ' + description) ||
    ((/开关/.test(description) || /^(?:true|false|t|f)$/i.test(info.value || '')) &&
      /\btrue\b/i.test(description) &&
      /\bfalse\b/i.test(description)) ||
    (info.module === 'ElastoDyn' && /DOF[12]?$/i.test(info.name))
  ) {
    const numeric = /^[01]$/.test(info.value || '');
    return [
      {
        value: numeric ? '1' : 'True',
        label: t('option.boolean.enabled'),
        source: t('option.source.boolean'),
      },
      {
        value: numeric ? '0' : 'False',
        label: t('option.boolean.disabled'),
        source: t('option.source.boolean'),
      },
    ];
  }
  return [];
}
export function specialValueChoices(info) {
  if (
    !/\b(?:or|use|accepts?|allows?)\s+["']?default\b|["']default["']/i.test(info.original || '') ||
    /File|Names|ProcName|OutFmt/i.test(info.name)
  )
    return [];
  const quote = /^["']/.exec(info.value || '')?.[0] || '';
  return [
    {
      value: quote + 'DEFAULT' + quote,
      label: t('option.programDefault'),
      source: t('editor.specialSource'),
    },
  ];
}
function valueContext(text, line, character, profile) {
  const source = text.split(/\r?\n/)[line];
  if (source === undefined) {
    return null;
  }
  if (/^\s*[-=]{3}/.test(source)) {
    return null;
  }
  const scanned = lex(source);
  const items = scanned.items;
  const module = detectModule(text) || 'OpenFAST';
  if (
    parseDocument(text).tokens.some(
      (token) =>
        token.line === line && ['output', 'end', 'header', 'cell', 'matrix'].includes(token.kind),
    )
  )
    return null;
  if (!items.length && module !== 'ROSCO') {
    return null;
  }
  if (module === 'ROSCO') {
    const match = /^([A-Za-z]\w*(?:\(\d+\))?)\s*(?:-\s*)?(.*)$/.exec(scanned.comment);
    if (
      !match ||
      !findEntry(match[1], module) ||
      items.length > 1 ||
      (character !== undefined && character > scanned.commentStart)
    )
      return null;
    const info = {
      name: match[1],
      module,
      value: source.slice(0, scanned.commentStart).trim(),
      original: match[2],
      profile,
    };
    const fixedOptions = optionsFor(info);
    const options = fixedOptions.length ? fixedOptions : specialValueChoices(info);
    if (!options.length) return null;
    const start = items[0]?.start ?? character ?? 0;
    const end = items[0]?.end ?? start;
    return {
      ...info,
      options,
      openNumeric: !fixedOptions.length,
      start,
      end,
      line,
      needsSeparator: !items.length && start === scanned.commentStart,
    };
  }
  const label = items.findIndex(
    (x, i) =>
      findEntry(x.text, module) &&
      (items[i + 1]?.text === '-' ||
        items[i + 1]?.text === '–' ||
        (i === 0 && items.length === 1) ||
        (i === 1 && !findEntry(items[0].text, module))),
  );
  if (label < 0 || label > 1) {
    return null;
  } // Only scalar values, never tables/matrices/lists.
  const parameter = items[label];
  if (character !== undefined && character > parameter.start) {
    return null;
  }
  const value = source.slice(0, parameter.start).trim();
  const original = source
    .slice(parameter.end, scanned.commentStart)
    .replace(/^\s*[-–]?\s*/, '')
    .trim();
  const info = { name: parameter.text, module, value, original, profile };
  const fixedOptions = optionsFor(info);
  const options = fixedOptions.length ? fixedOptions : specialValueChoices(info);
  if (!options.length) {
    return null;
  }
  const start = label === 1 ? items[0].start : (character ?? parameter.start);
  const end = label === 1 ? items[0].end : start;
  if (character !== undefined && label === 1 && (character < start || character > end)) {
    return null;
  }
  return {
    ...info,
    options,
    openNumeric: !fixedOptions.length,
    start,
    end,
    line,
    needsSeparator: label === 0,
  };
}
export { optionsFor, valueContext };
