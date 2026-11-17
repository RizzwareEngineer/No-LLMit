"""Facts from an engine stream read by check-states.sh: `seated` (the table's players, from the state messages) or `bets`
(whether every bet and raise is a seat's whole stack, as MOCK_BETS=big plays)."""
import json, sys

msgs = []
for line in sys.stdin:
    if line.startswith('data:'):
        try: msgs.append(json.loads(line[5:]))
        except ValueError: pass
states = [m['payload'] for m in msgs if m.get('type') == 'game_state'] + \
         [t['state'] for m in msgs if m.get('type') == 'snapshot' for t in m['payload'].get('tables', {}).values() if t.get('state')]
if sys.argv[1] == 'seated':
    names = []
    for st in states:
        for p in st.get('players', []):
            if p['name'] not in names: names.append(p['name'])
    print('seated: ' + ', '.join(names))
else:
    # A bet or raise at the maximum is the whole stack, which the engine reports as ALL_IN.
    sized = [m['payload'] for m in msgs if m.get('type') == 'llm_action' and m['payload'].get('action') in ('BET', 'RAISE', 'ALL_IN')]
    # The stack before a bet: the seat's stack plus its street bet in the state just before the action.
    small = []
    for i, m in enumerate(msgs):
        p = m.get('payload') or {}
        if m.get('type') == 'llm_action' and p.get('action') in ('BET', 'RAISE'):
            prev = next((x['payload'] for x in reversed(msgs[:i]) if x.get('type') == 'game_state'), None)
            if prev:
                pl = prev['players'][p['playerIdx']]
                if p['amount'] < pl['stack'] + pl.get('currentBet', 0): small.append(p['amount'])
    print(('all at the maximum' if sized and not small else 'NOT all at the maximum') + f': {len(sized)} bets and raises, amounts {[s["amount"] for s in sized][:8]}, below the stack: {small[:5]}')
