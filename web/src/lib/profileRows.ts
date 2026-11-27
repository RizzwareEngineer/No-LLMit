// Profiles' dash rows (a model with no hands yet): the seated models' only, as the rows with hands, unless `all`
// ("All models", the card's), where everyone with hands is a row too. `pending`: models with no hands yet at the hand
// the replay shows. Without the seat filter a model not seated was a dash row only until its first hand in the replay
// (then one of the hidden others): the card grew and shrank as the replay played, and a reload's stand-in (the card's
// last size, lib/boxes) did not match it. Without a lineup (`seated` undefined) every model is a row.
export function dashRows(noHands: string[], pending: string[], seated: string[] | undefined, all: boolean): string[] {
  return [...new Set([...noHands, ...pending])].filter(name => all || !seated || seated.includes(name));
}
