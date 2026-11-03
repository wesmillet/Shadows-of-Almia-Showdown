/**
 * Starter achievements: permanent unlocks saved to a player's account. Each one adds a Pokémon the
 * player can nominate for the third starter slot (src/sim/starters.ts). The first gives a random
 * Uncommon; the others let the player choose one of three (a choice is final).
 */
export type StarterStat = 'catches' | 'matches' | 'species' | 'top3';

export interface StarterAchievement {
  id: string;
  name: string;
  desc: string;
  stat: StarterStat;
  goal: number;
  reward: { kind: 'random'; tier: string } | { kind: 'choice'; options: string[] };
}

export const STARTER_ACHIEVEMENTS: StarterAchievement[] = [
  { id: 'first_catch', name: 'First Catch', desc: 'Catch a Pokémon', stat: 'catches', goal: 1, reward: { kind: 'random', tier: 'uncommon' } },
  { id: 'three_matches', name: 'Getting Started', desc: 'Finish 3 matches', stat: 'matches', goal: 3, reward: { kind: 'choice', options: ['0252', '0255', '0258'] } },
  { id: 'ten_species', name: 'Field Researcher', desc: 'Catch 10 different species', stat: 'species', goal: 10, reward: { kind: 'choice', options: ['0387', '0390', '0393'] } },
  { id: 'podium_three', name: 'Podium Regular', desc: 'Finish in the top three 3 times', stat: 'top3', goal: 3, reward: { kind: 'choice', options: ['0152', '0155', '0158'] } },
];

/** What /api/starters answers (the Starters panel). */
export interface StartersInfo {
  achievements: Array<{ id: string; name: string; desc: string; goal: number; progress: number; done: boolean; reward: StarterAchievement['reward']; dex: string | null }>;
  eligible: Array<{ dex: string; tier: string; cost: number }>;
  nominations: string[];
  budget: number;
  slots: number;
  costs: Record<string, number>;
  weights: Record<string, number>;
}
