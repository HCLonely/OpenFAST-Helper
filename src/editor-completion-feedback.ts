import { tableColumn, tableReferenceChoices, pathContext } from './editor-context';
import { countedArrayContext } from './editor-arrays';
import { tableValueChoices } from './table-rules';
import { fieldType } from './table-layout';
import { textSnapshot } from './editor-snapshot';
import { lex } from './parser';
import rules from '../data/array-rules.json';
import { t } from './i18n';
import { unusedIds } from './editor-table';
import { valueContext } from './value-options';

export function completionExplanation(
  text: string,
  line: number,
  character: number,
  profile?,
  settings = {},
) {
  const result = (code, detail, command?, args = []) => ({ code, detail, command, args });
  if (text.length > 2000000)
    return result('large', t('editor.suggestLarge'), 'openfast.showEditorPerformance');
  const config = (key) => settings[key] !== false;
  const where = tableColumn(text, line, character);
  if (where && line !== where.table.line) {
    if (!config('enableTableSuggestions'))
      return result(
        'disabled',
        t('editor.suggestDisabled', 'enableTableSuggestions'),
        'workbench.action.openSettings',
        ['openfast.enableTableSuggestions'],
      );
    const refs = tableReferenceChoices(text, line, character);
    if (fieldType(where.field) === 'reference' && !refs?.choices.length)
      return result('definitions', t('editor.suggestDefinitions', where.field));
    if (
      refs?.choices.length ||
      unusedIds(where.table, where.field, textSnapshot(text).parsed.module).length ||
      tableValueChoices(textSnapshot(text).parsed.module, where.field).length
    )
      return result('available', t('editor.suggestAvailable'));
    return result('physical', t('editor.suggestPhysical', where.field));
  }
  const snapshot = textSnapshot(text),
    scan = lex(snapshot.lines[line] || '');
  const rule = rules.rules.find(
    (r) =>
      r.module === snapshot.parsed.module &&
      scan.items.some((c) => c.text === r.name && c.start >= character),
  );
  if (rule) {
    if (!config('enableTableSuggestions'))
      return result(
        'disabled',
        t('editor.suggestDisabled', 'enableTableSuggestions'),
        'workbench.action.openSettings',
        ['openfast.enableTableSuggestions'],
      );
    if (profile?.known && !rule.versions.includes(profile.version))
      return result(
        'version',
        t('editor.suggestVersion', profile.version, rule.versions.join('/')),
        'workbench.action.openSettings',
        ['openfast.version'],
      );
    const array = countedArrayContext(text, line, character, profile);
    if (!array) return result('count', t('editor.suggestCount', rule.count, rule.maxCount));
    if (!array.count || array.index > array.count)
      return result('count', t('editor.suggestArrayFull', array.index, array.count));
    if (!array.nodes)
      return result(
        'bounds',
        t('editor.suggestBounds', rule.nodeCount || 'NumBlNds'),
        'openfast.insertArrayValues',
      );
    return result('available', t('editor.suggestAvailable'));
  }
  const path = pathContext(text, line, character);
  if (path) {
    if (!config('enablePathSuggestions'))
      return result(
        'disabled',
        t('editor.suggestDisabled', 'enablePathSuggestions'),
        'workbench.action.openSettings',
        ['openfast.enablePathSuggestions'],
      );
    return result('path', t('editor.suggestPath'), 'openfast.repairMissingPath');
  }
  const scalar = valueContext(text, line, character, profile);
  if (scalar) {
    if (!config('enableValueSuggestions'))
      return result(
        'disabled',
        t('editor.suggestDisabled', 'enableValueSuggestions'),
        'workbench.action.openSettings',
        ['openfast.enableValueSuggestions'],
      );
    return result('available', t('editor.suggestAvailable'));
  }
  return result('context', t('editor.suggestContext'));
}
