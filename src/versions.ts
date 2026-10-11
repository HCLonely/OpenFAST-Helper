import { t } from './i18n';
const CHANGE_URL = 'https://openfast.readthedocs.io/en/main/source/user/api_change.html';
const SUPPORTED = ['auto', '3.5', '4.0', '4.1', '4.2', '5.0', 'main'];
function resolveVersion(text, setting = 'auto') {
  const match = /(?:OpenFAST\s*(?:[-–:]\s*)?v?)(\d+\.\d+(?:\.\d+)?)/i.exec(
    text.split(/\r?\n/).slice(0, 15).join('\n'),
  );
  const detected = match?.[1];
  const selected = setting !== 'auto' ? setting : detected?.split('.').slice(0, 2).join('.');
  return {
    version: selected || 'unknown',
    known: !!selected && SUPPORTED.includes(selected),
    explicit: setting !== 'auto',
    detected,
    major: selected === 'main' ? 5 : Number(selected?.split('.')[0]),
    source:
      setting !== 'auto'
        ? t('version.source.workspace')
        : detected
          ? t('version.source.header')
          : t('version.source.unknown'),
  };
}
function versionOptions(module, name, profile) {
  if (!profile?.known) {
    return undefined;
  }
  let choices;
  if (module === 'OpenFAST' && name.toLowerCase() === 'compaero') {
    choices =
      profile.major >= 4
        ? { 0: t('option.aero.disabled'), 1: 'AeroDisk', 2: 'AeroDyn', 3: 'ExtLoads' }
        : { 0: t('option.aero.disabled'), 1: 'AeroDyn v14', 2: 'AeroDyn v15' };
  }
  if (module === 'OpenFAST' && name.toLowerCase() === 'compelast') {
    choices =
      profile.major >= 4
        ? {
            1: 'ElastoDyn',
            2: t('option.structure.beamDynBlades'),
            3: t('option.structure.simplifiedElastoDyn'),
          }
        : { 1: 'ElastoDyn', 2: t('option.structure.beamDynBlades') };
  }
  if (module === 'OpenFAST' && name.toLowerCase() === 'modcoupling' && profile.major >= 5) {
    choices = {
      1: t('option.coupling.loose'),
      2: t('option.coupling.fixedJacobian'),
      3: t('option.coupling.automaticJacobian'),
    };
  }
  if (module === 'SeaState' && name.toLowerCase() === 'wvcrntmod' && profile.major >= 5) {
    choices = {
      0: t('option.wave.currentSuperposition'),
      1: t('option.wave.doppler'),
      2: t('option.wave.dopplerAndScaling'),
    };
  }
  return (
    choices &&
    Object.entries(choices).map(([value, label]) => ({
      value,
      label,
      source: t('option.source.verifiedVersion', profile.version),
    }))
  );
}
function versionIssues(parsed, profile) {
  if (!profile?.known) {
    return [];
  }
  const issues = [];
  const added5 = {
    OpenFAST: [
      'ModCoupling',
      'RhoInf',
      'ConvTol',
      'MaxConvIter',
      'NRotors',
      'CompSoil',
      'MirrorRotor',
      'SoilFile',
    ],
    ElastoDyn: ['PitchDOF', 'PtfmRefxt', 'PtfmRefyt', 'PBrIner(1)', 'BlPIner(1)'],
    SeaState: ['WvCrntMod'],
    HydroDyn: ['HstMod'],
  };
  const removed5 = {
    AeroDyn: ['Buoyancy'],
    BeamDyn: ['UsePitchAct', 'PitchJ', 'PitchK', 'PitchC'],
  };
  for (const entry of parsed.records || parsed.parameters.values()) {
    let message;
    if (profile.major < 5 && added5[parsed.module]?.includes(entry.name)) {
      message = t('diagnostic.versionAdded', entry.name, profile.version);
    }
    if (profile.major >= 5 && removed5[parsed.module]?.includes(entry.name)) {
      message = t('diagnostic.versionRemoved', entry.name);
    }
    if (message) {
      issues.push({
        ...entry,
        severity: 'warning',
        code: 'version-field',
        message,
        url: CHANGE_URL,
      });
    }
  }
  if (
    profile.major >= 5 &&
    parsed.module === 'OpenFAST' &&
    (parsed.parameters.has('CompElast') || parsed.parameters.has('TMax'))
  ) {
    for (const name of ['ModCoupling', 'NRotors']) {
      if (!parsed.parameters.has(name)) {
        issues.push({
          line: 0,
          start: 0,
          end: 1,
          severity: 'warning',
          code: 'version-required',
          message: t('diagnostic.versionMissingField', profile.version, name),
          url: CHANGE_URL,
        });
      }
    }
  }
  return issues;
}
function documentationUrl(url, profile) {
  if (!profile?.known || profile.version === 'main' || profile.major >= 5) {
    return url;
  }
  // Not all release tags have an RTD build. Use verified official entry points
  // instead of inventing anchors in archived HTML pages.
  if (profile.version === '3.5') {
    return 'https://openfast.readthedocs.io/en/v3.5.3/source/user/index.html';
  }
  return `https://github.com/OpenFAST/openfast/tree/v${profile.version}.0/docs/source/user`;
}
export { SUPPORTED, CHANGE_URL, resolveVersion, versionOptions, versionIssues, documentationUrl };
