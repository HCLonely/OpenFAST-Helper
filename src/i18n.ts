import englishMessages from '../data/ui.en.json';
import chineseMessages from '../data/ui.zh-CN.json';
import englishCatalog from '../data/catalog.en.json';
import { findEntry, supplementalParameters } from './catalog';
export type Language = 'zh-CN' | 'en';
export type LanguagePreference = 'auto' | Language;
export type MessageKey = keyof typeof chineseMessages;
let resolveLanguage: () => string = () => 'zh-CN';
/** Keep VS Code access in the editor adapter so translations are testable in Node. */
export function configureLanguage(resolver: () => string): void {
  resolveLanguage = resolver;
}
export function languageFor(preference: string, interfaceLanguage: string): Language {
  const selected = preference === 'auto' ? interfaceLanguage : preference;
  return /^zh(?:-|$)/i.test(selected) ? 'zh-CN' : 'en';
}
export function currentLanguage(): Language {
  return languageFor('auto', resolveLanguage());
}
const dictionaries: Record<Language, Record<MessageKey, string>> = {
  en: englishMessages,
  'zh-CN': chineseMessages,
};
// Parser-generated explanations remain Chinese internally. Match their display
// templates here without using display text as a public translation key.
function textTranslations(language: Language): Map<string, string> {
  const otherLanguage = language === 'en' ? 'zh-CN' : 'en';
  return new Map(
    (Object.keys(chineseMessages) as MessageKey[]).map((key) => [
      dictionaries[otherLanguage][key],
      dictionaries[language][key],
    ]),
  );
}
const generatedTextTranslations = {
  en: textTranslations('en'),
  'zh-CN': textTranslations('zh-CN'),
};
function translationPatterns(language: Language) {
  return [...generatedTextTranslations[language]]
    .filter(([template]) => /\{\d+\}/.test(template))
    .map(([template, translation]) => ({
      pattern: new RegExp(
        '^' +
          template
            .split(/\{\d+\}/)
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('([\\s\\S]*?)') +
          '$',
      ),
      translation,
    }));
}
const patterns = { en: translationPatterns('en'), 'zh-CN': translationPatterns('zh-CN') };
/** Translate generated UI prose; never use this for the user's file comments. */
export function localizeText(value: string, depth = 0): string {
  if (!value || depth > 5) {
    return value;
  }
  const language = currentLanguage();
  const translated = generatedTextTranslations[language].get(value);
  if (translated !== undefined) {
    return translated;
  }
  for (const { pattern, translation } of patterns[language]) {
    const match = pattern.exec(value);
    if (match) {
      return translation.replace(/\{(\d+)\}/g, (_, index) =>
        localizeText(match[Number(index) + 1], depth + 1),
      );
    }
  }
  return value;
}
/** Conditions contain generated fragments rather than arbitrary file comments. */
export function localizeApplicability(value: string): string {
  if (currentLanguage() === 'zh-CN') {
    return value;
  }
  return localizeText(
    value
      .replaceAll('取 ', 'equals ')
      .replaceAll('大于 0', 'greater than 0')
      .replaceAll(' 且 ', ' and ')
      .replaceAll('未找到', 'Not found'),
  ).replaceAll('，', ', ');
}
export function t(key: MessageKey, ...values: unknown[]): string {
  const template = dictionaries[currentLanguage()][key] ?? chineseMessages[key];
  return template.replace(/\{(\d+)\}/g, (_, index) => localizeText(String(values[Number(index)])));
}
export function moduleLabel(module: string): string {
  return module === '通用' ? t('common.general') : module;
}
interface DescriptionContext {
  name: string;
  module?: string;
  kind?: string;
  description?: string;
  row?: number;
  column?: number;
}
export function descriptionFor(info: DescriptionContext): string {
  const source = findEntry(info.name, info.module ?? '通用', info.kind ?? 'parameter');
  if (currentLanguage() === 'zh-CN') {
    return info.description ?? source?.description ?? t('description.unavailable');
  }
  const supplemental =
    source && supplementalParameters.get(`${source.module}:${source.name.toLowerCase()}`);
  if (supplemental) return supplemental.descriptionEn;
  const kind =
    info.kind === 'output'
      ? 'outputs'
      : ['header', 'cell'].includes(info.kind)
        ? 'tables'
        : 'parameters';
  const entry = englishCatalog[kind].find(
    (candidate) =>
      candidate.name === source?.name &&
      ('module' in candidate ? candidate.module === source.module : true),
  );
  if (info.kind === 'matrix') {
    const axes = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ'];
    if (info.name === 'AddF0') {
      return t(
        'description.preloadComponent',
        info.row,
        axes[info.row - 1],
        info.row <= 3 ? 'N' : 'N·m',
      );
    }
    const force = info.row <= 3 ? 'N' : 'N·m';
    const input = info.column <= 3 ? 'm' : 'rad';
    const unit =
      info.name === 'AddCLin'
        ? `${force}/${input}`
        : info.name === 'AddBLin'
          ? `${force}/(${input}/s)`
          : `${force}/(${input}/s)²`;
    return t(
      'description.matrixComponent',
      entry?.description ?? info.name,
      info.row,
      axes[info.row - 1],
      info.column,
      axes[info.column - 1],
      unit,
    );
  }
  if (entry) {
    return entry.description;
  }
  const tension = /^(FairTen|AnchTen)(\d+)$/i.exec(info.name);
  if (tension) {
    return t(
      'description.mooringTension',
      tension[2],
      t(/fair/i.test(tension[1]) ? 'mooring.fairlead' : 'mooring.anchor'),
    );
  }
  return localizeText(
    info.description ?? '中文参数库尚未收录此项；请参考本行原始说明及所用 OpenFAST 版本文档。',
  );
}
