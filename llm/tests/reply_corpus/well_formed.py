# -*- coding: utf-8 -*-
"""Ordinary well-formed three-line replies, generated over dress variants: none may be a miss."""
import itertools
R = lambda n: ("R", n)
F, X, C, A, N = "F", "X", "C", "A", "N"
MOVES = [  # (action text, amount text, intent)
 ("fold", "0", F), ("Fold", "0", F), ("FOLD", "0", F), ("fold", "N/A", F),
 ("call", "0", C), ("Call", "100", C), ("CALL", "0", C), ("call", "100 (to call)", C), ("Call", "$100", C),
 ("check", "0", X), ("Check", "0", X),
 ("raise", "300", R(300)), ("Raise", "300", R(300)), ("RAISE", "300", R(300)), ("raise to 300", "300", R(300)),
 ("raise", "$300", R(300)), ("raise", "300 chips", R(300)), ("Raise", "300 (3x)", R(300)), ("raise", "300 total", R(300)),
 ("bet", "120", R(120)), ("Bet", "$120", R(120)), ("BET", "120 chips", R(120)), ("bet", "1,130", R(1130)),
 ("all-in", "1130", A), ("All-in", "1,130", A), ("ALL-IN", "0", A), ("All in", "1130", A), ("all-in", "1130 (all-in)", A),
 ("raise", "all-in", A),
]
DRESS = [
 "ACTION: {a}\nAMOUNT: {m}\nREASON: {r}",
 "**ACTION:** {a}\n**AMOUNT:** {m}\n**REASON:** {r}",
 "ACTION: {a}\r\nAMOUNT: {m}\r\nREASON: {r}\r\n",
 "```\nACTION: {a}\nAMOUNT: {m}\nREASON: {r}\n```",
 "Here is my decision.\n\nACTION: {a}\nAMOUNT: {m}\nREASON: {r}",
 "ACTION: {a}\nAMOUNT: {m}\nREASON: {r}\n\nGood luck!",
 "Action: {a}\nAmount: {m}\nReason: {r}",
 "ACTION: {a}.\nAMOUNT: {m}.\nREASON: {r}",
 "  ACTION: {a}  \n  AMOUNT: {m}  \n  REASON: {r}  ",
 "ACTION: **{a}**\nAMOUNT: **{m}**\nREASON: {r}",
 "<think>\nHe bets 100 into 150. Action: fold is too weak? Amount: maybe 300.\n</think>\n\nACTION: {a}\nAMOUNT: {m}\nREASON: {r}",
 "ACTION: {a}\n\nAMOUNT: {m}\n\nREASON: {r}",
]
REASONS = [
 "Top pair, good kicker; he bets 100 into 150, so I continue.",
 "If he raises, I fold; a call here is fine against his range of bets and bluffs.",
 "Amount: 300 would be standard. Action: depends on his range.",
 "Pot odds 3.5:1 (I need 22%), and I have 9 outs plus 2 overcards.",
]
CORPUS4 = [("ord", d.format(a=a, m=m, r=r), it) for (a, m, it), d, r in itertools.product(MOVES, DRESS, REASONS)]
NOUNS = [
 ("noun", "ACTION: call the bet\nAMOUNT: 0\nREASON: Odds.", C),
 ("noun", "ACTION: call his bet\nAMOUNT: 100\nREASON: Odds.", C),
 ("noun", "ACTION: fold to the raise\nAMOUNT: 0\nREASON: Weak.", F),
 ("noun", "ACTION: fold to his bet\nAMOUNT: 0\nREASON: Weak.", F),
 ("noun", "ACTION: call the raise\nAMOUNT: 0\nREASON: Odds.", C),
 ("noun", "ACTION: raise to 300, 3x his bet\nREASON: Value.", R(300)),
 ("noun", "ACTION: raise to 300 (3x his bet)\nREASON: Value.", R(300)),
 ("noun", "ACTION: check (no bet to call)\nAMOUNT: 0\nREASON: Free card.", X),
 ("noun", "ACTION: check, no bet to call\nAMOUNT: 0\nREASON: Free card.", X),
 ("noun", "ACTION: call 100 to see the river\nAMOUNT: 0\nREASON: Odds.", C),
 ("noun", "ACTION: fold, not worth a call\nAMOUNT: 0\nREASON: Weak.", F),
 ("noun", "ACTION: raise (re-raise his bet)\nAMOUNT: 300\nREASON: Value.", R(300)),
 ("noun", "Final answer:\nACTION: call\nAMOUNT: 0\nREASON: Odds.", C),
 ("noun", "**Final Answer:** ACTION: call\nAMOUNT: 0\nREASON: Odds.", C),
]
CORPUS4 += NOUNS
