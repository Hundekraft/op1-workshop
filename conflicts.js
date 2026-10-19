// Exclusive declarations only. A key claim includes its mode; shared hook callbacks are not claims.
export function resolveConflicts(entries, {winners = {}, off = [], holder = {}} = {}) {
  const disabled = new Set(off), errors = [], by = new Map();
  const namesSeen = new Set();
  for (const e of entries) {
    if (namesSeen.has(e.name)) errors.push(`More than one file provides ${e.name}`);
    namesSeen.add(e.name);
  }
  const active = entries.filter(e => !disabled.has(e.name));
  for (const e of active) for (const c of new Set(e.claims || [])) {
    if (typeof c !== 'string' || !c) continue;
    if (!by.has(c)) by.set(c, []);
    by.get(c).push(e);
  }
  const compare = (a, b) => Number(b.source === 'builtin') - Number(a.source === 'builtin') ||
    ((a.priority ?? Infinity) - (b.priority ?? Infinity) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const conflicts = [...by].filter(([, es]) => es.length > 1).map(([claim, es]) => {
    const names = es.map(e => e.name), choice = winners[claim];
    if (choice != null && !names.includes(choice)) errors.push(`Invalid choice for ${claim}`);
    return {claim, names, winner: [...es].sort(compare)[0].name,
      suggested: names.includes(holder[claim]) ? holder[claim] : null,
      choice: names.includes(choice) ? choice : null};
  });
  // Explicit winners must all remain enabled. A plugin cannot win one resource and lose another.
  const required = new Set(conflicts.filter(c => c.choice).map(c => c.choice));
  for (const c of conflicts) if (c.choice) for (const n of c.names) if (n !== c.choice) {
    if (required.has(n)) errors.push(`${n} is selected for one resource and switched off for another`);
    disabled.add(n);
  }
  const explicitOff = new Set(disabled);
  // Firmware's preference order provides one consistent preview across the entire graph.
  const kept = [];
  for (const e of [...active].sort((a, b) => Number(required.has(b.name)) - Number(required.has(a.name)) || compare(a, b))) {
    if (disabled.has(e.name)) continue;
    const clash = kept.some(k => (e.claims || []).some(c => (k.claims || []).includes(c)));
    if (clash) disabled.add(e.name); else kept.push(e);
  }
  const result = entries.map(e => ({...e, on: !disabled.has(e.name)}));
  for (const c of conflicts) c.implied = !c.choice && c.names.filter(n => !explicitOff.has(n)).length <= 1;
  const unresolved = conflicts.filter(c => !c.choice && !c.implied).map(c => c.claim);
  const unknown = entries.filter(e => e.claimsKnown === false).map(e => e.name);
  return {entries: result, conflicts, off: [...disabled].sort(), unresolved, errors, unknown,
    resolved: !unresolved.length && !errors.length};
}
