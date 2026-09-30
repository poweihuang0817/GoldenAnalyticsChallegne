import {format} from 'sql-formatter';
import type {Backend} from '../backend.js';

/** Display-only formatting; the original compiled query is always executed. */
export function sqlPreview(sql: string, backend: Backend) {
  try {
    return {text: format(sql, {language: backend === 'postgres' ? 'postgresql' : backend, tabWidth: 2}), formatted: true};
  } catch {
    return {text: sql, formatted: false};
  }
}

/** A bounded operator summary, not another compiler or a complete plan serializer. */
export function planOutline(plan: any): string {
  const functions = new Map<number, string>((plan.extensions ?? []).filter((e: any) => e.extensionFunction)
    .map((e: any) => [e.extensionFunction.functionAnchor, e.extensionFunction.name]));
  const fn = (value: any) => functions.get(value.functionReference) ?? `function#${value.functionReference}`;
  function expr(value: any, depth = 0): string {
    if (!value || depth > 12) return '[expression: see JSON]';
    if (value.selection) return `field#${value.selection.directReference?.structField?.field ?? '?'}`;
    if (value.literal) return JSON.stringify(value.literal);
    if (value.scalarFunction) return `${fn(value.scalarFunction)}(${(value.scalarFunction.arguments ?? []).map((a: any) => expr(a.value, depth + 1)).join(', ')})`;
    if (value.ifThen) return 'CASE [see JSON]';
    return '[expression: see JSON]';
  }
  const lines: string[] = [];
  function visit(rel: any, indent = '', edge = '') {
    if (!rel || indent.length > 100) { lines.push(`${indent}${edge}[see JSON]`); return; }
    const kind = ['read','filter','project','join','aggregate','sort','fetch','window'].find(k => rel[k]);
    if (!kind) { lines.push(`${indent}${edge}[unrecognized relation: see JSON]`); return; }
    const node = rel[kind];
    let label = kind[0].toUpperCase() + kind.slice(1);
    if (kind === 'read') label += ` ${node.namedTable?.names?.join('.') ?? '[source]'} (${(node.baseSchema?.names ?? []).map((n: string, i: number) => `${i}: ${n}`).join(', ')})`;
    if (kind === 'filter') label += `: ${expr(node.condition)}`;
    if (kind === 'join') label += ` ${node.type ?? ''}: ${expr(node.expression)}`;
    if (kind === 'project') label += `: ${(node.expressions ?? []).length} expression(s)`;
    if (kind === 'aggregate') label += `: ${(node.measures ?? []).map((m: any) => fn(m.measure)).join(', ')}; ${(node.groupings ?? []).map((g: any) => (g.groupingExpressions ?? []).length).join('/')} grouping key(s)`;
    if (kind === 'sort') label += `: ${(node.sorts ?? []).length} key(s)`;
    if (kind === 'fetch') label += `: count ${node.count ?? '?'}, offset ${node.offset ?? 0}`;
    lines.push(indent + edge + label);
    if (node.left) visit(node.left, indent + '  ', 'left: ');
    if (node.right) visit(node.right, indent + '  ', 'right: ');
    if (node.input) visit(node.input, indent + '  ');
  }
  for (const relation of plan.relations ?? []) {
    if (relation.root) { lines.push(`Output: ${(relation.root.names ?? []).join(', ')}`); visit(relation.root.input, '  '); }
    else visit(relation.rel);
  }
  return lines.join('\n') || '[No relations: see JSON]';
}
