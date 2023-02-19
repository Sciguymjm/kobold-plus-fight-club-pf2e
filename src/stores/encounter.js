import { acceptHMRUpdate, defineStore } from "pinia";
import { useParty } from "./party";
import * as helpers from "../js/helpers";
import { useNotifications } from "./notifications";
import CONST from "../js/constants";
import { useMonsters } from "./monsters";
import { useFilters } from "./filters";
import { useLocalStorage } from "@vueuse/core/index";

export const useEncounter = defineStore("encounter", {
  state: () => {
    return {
      groups: useLocalStorage("encounterGroups", []),
      insaneDifficultyStrings: [
        "an incredibly bad idea",
        "suicide",
        "/r/rpghorrorstories",
        "an angry table",
        "the BBEG wrote this encounter",
        "the party's final session",
        "someone forgot to bring snacks",
        "rocks fall",
        "someone insulted the DM"
      ],
      loadedIndex: helpers.migrateLocalStorage(
        "encounterLoadedIndex",
        "loadedEncounterIndex",
        null
      ),
      loadedLast: false,
      difficulty: helpers.migrateLocalStorage(
        "encounterDifficulty",
        "difficulty",
        "medium"
      ),
      type: helpers.migrateLocalStorage(
        "encounterGenerateType",
        "encounterType",
        "random"
      ),
      history: helpers.migrateLocalStorage(
        "encounterGenerateHistory",
        "encounterHistory",
        []
      ),
      saved: helpers.migrateLocalStorage(
        "encounterSaved",
        "savedEncounters",
        []
      )
    };
  },
  actions: {
    getDifficultyFromExperience(exp) {
      const levels = useParty().experience;

      if (!levels) {
        return "N/A";
      }

      if (exp === 0) return "None";
      if (exp < levels.easy) return "Trivial";
      if (exp < levels.medium) return "Easy";
      if (exp < levels.hard) return "Medium";
      if (exp < levels.deadly) return "Hard";

      return "Deadly";
    },
    generateRandom() {
      const party = useParty();

      party.ensureGroup();

      const totalExperienceTarget = party.experience[this.difficulty];

      if (!totalExperienceTarget) return;

      let fudgeFactor = 1.1; // The algorithm is conservative in spending exp; so this tries to get it closer to the actual medium value
      let baseExpBudget = totalExperienceTarget * fudgeFactor;
      let encounterTemplate = this.getEncounterTemplate();
      let totalAvailableXP = baseExpBudget;

      let targetExp;
      const newEncounter = [];
      encounterTemplate.groups.reverse();

      for (const group of encounterTemplate.groups) {
        targetExp = encounterTemplate.subtractive
          ? totalAvailableXP / encounterTemplate.groups.length
          : totalAvailableXP * group.ratio;

        targetExp /= group.count;

        const monster = this.getBestMonster(
          targetExp,
          newEncounter,
          group.count
        );
        if (!monster) {
          useNotifications().notify({
            title: "Failed to generate encounter!",
            body: "Change the filters so that there are more monsters to sample from.",
            icon: "fa-circle-xmark",
            icon_color: "text-red-400",
            sticky: true
          });
          return false;
        }

        newEncounter.push({
          monster,
          count: group.count
        });
      }

      newEncounter.reverse();

      this.groups = newEncounter;

      this.saveToHistory(true);
    },
    getBestMonster(targetExp, encounter, numMonsters) {
      console.log(`targetExp: ${targetExp} encounter: ${encounter} numMonsters: ${numMonsters}`);
      const party = useParty();
      const monsters = useMonsters();

      let monsterCRIndex;
      // list is range from -1 to 30
      for (let i = 31; i >= -1; i--) {
        const lowerBound = i;
        const upperBound = i + 1;
        let upperExp = getExp(party, upperBound);
        let lowerExp = getExp(party, lowerBound);
        console.log(`${lowerBound} ${lowerExp} < ${targetExp} < ${upperBound} ${upperExp}`);
        if (lowerExp < targetExp) {
          monsterCRIndex =
            targetExp - lowerExp < upperExp - targetExp ? i : i + 1;
          break;
        }
      }
      if (monsterCRIndex === undefined) {
        monsterCRIndex = -1;
      }
      console.log(`monsterCRIndex: ${monsterCRIndex}`);

      let monsterTargetCR = {
        numeric: monsterCRIndex
      };
      let monsterList = monsters.filterBy(
        useFilters().overriddenCopy({
          minCr: monsterTargetCR.numeric,
          maxCr: monsterTargetCR.numeric
        }),
        (monster) => {
          return (
            !encounter.some((group) => group.monster === monster) &&
            !(numMonsters > 1 && monster.isUnique)
          );
        }
      );

      let monsterCRNewIndex = monsterCRIndex;
      let down = true;
      while (!monsterList.length) {
        if (down) {
          monsterCRNewIndex--;
          if (monsterCRNewIndex < 0) {
            monsterCRNewIndex = monsterCRIndex;
            down = false;
          }
        } else {
          monsterCRNewIndex++;
          if (monsterCRNewIndex === threatLevelList.length - 1) {
            return false;
          }
        }

        let monsterTargetCR = CONST.THREAT[threatLevelList[monsterCRNewIndex]];
        monsterList = monsters.filterBy(
          useFilters().overriddenCopy({
            minCr: monsterTargetCR.numeric,
            maxCr: monsterTargetCR.numeric
          }),
          (monster) => {
            return !encounter.some((group) => group.monster === monster);
          }
        );
      }

      return helpers.randomArrayElement(monsterList);
    },
    getEncounterTemplate() {
      let template = helpers.clone(CONST.ENCOUNTER_TYPES[this.type]);

      template = helpers.randomArrayElement(template.samples);
      if (this.type === "random") {
        template = {
          subtractive: true,
          groups: template.map((num) => {
            return { count: num };
          })
        };
      }

      const players = Number(useParty().totalPlayers);
      template.groups = template.groups.map((group) => {
        if (typeof group.count === "string") {
          const parts = group.count.split("-").map((part) => {
            part = part.replaceAll("players", players);
            return eval(part);
          });
          group.count =
            parts.length > 1 ? helpers.randomIntBetween(...parts) : parts[0];
        }
        return group;
      });

      template.total = template.groups.reduce(
        (acc, group) => acc + group.count,
        0
      );

      if (this.type === "random") {
        template.overallRatio = template.groups.reduce(
          (acc, group) => acc + (group.ratio || 1),
          0
        );
        template.groups.forEach((group) => {
          group.ratio = (group.ratio || 1) / template.overallRatio;
        });
      }

      return template;
    },
    getNewMonster(group) {
      const monsterList = useMonsters().filterBy(
        useFilters().overriddenCopy({
          maxCr: group.monster.cr.numeric,
          minCr: group.monster.cr.numeric
        }),
        (monster) => {
          return !this.groups.some((group) => group.monster === monster);
        }
      );
      if (!monsterList.length) return;
      group.monster = helpers.randomArrayElement(monsterList);
      this.saveToHistory();
    },
    addMonster(monster) {
      if (!useParty().totalPlayers) {
        useParty().addPlayerGroup();
      }

      let group;
      let index = this.groups.findIndex((group) => group.monster === monster);
      if (index === -1) {
        this.groups.push({
          monster,
          count: 1
        });
      } else {
        group = this.groups[index];
        group.count++;
      }

      this.saveToHistory();
    },

    addCount(index) {
      this.groups[index].count++;
      this.saveToHistory();
    },

    subtractCount(index) {
      this.groups[index].count--;
      if (this.groups[index].count <= 0) {
        this.groups.splice(index, 1);
      }
      this.saveToHistory();
    },

    saveToHistory(newEntry = false) {
      const encounter = this.groups
        .map((group) => {
          return {
            monster: {
              name: group.monster.name,
              slug: group.monster.slug
            },
            count: group.count
          };
        })
        .filter((group) => group.count > 0);

      const lastEntry = this.history[this.history.length - 1];
      if (!encounter.length) {
        if (lastEntry) {
          this.loadedLast = false;
          this.history.pop();
        }
        return;
      }

      if (newEntry || !lastEntry) {
        this.history.push(encounter);
      }

      this.history[this.history.length - 1] = encounter;
    },

    save() {
      if (!this.groups.length) return;
      const encounter = this.groups.map((group) => {
        return {
          monster: {
            name: group.monster.name,
            slug: group.monster.slug
          },
          count: group.count
        };
      });
      if (this.loaded) {
        this.saved[this.loaded] = encounter;
      } else {
        this.loadedIndex = this.saved.length;
        this.saved = [...this.saved, encounter];
      }
      useNotifications().notify({
        title: "Encounter saved"
      });
    },

    loadFromHistory(index) {
      this.loadedIndex = null;
      this.loadedLast = true;
      const encounter = this.history.splice(index, 1)[0];
      this.history.push(encounter);
      this.load(encounter);
      useNotifications().notify({
        title: "Encounter loaded",
        body: this.groups
          .map((group) => `${group.monster.name} x${group.count}`)
          .join(", ")
      });
    },

    load(encounter) {
      useParty().ensureGroup();

      const groups = helpers
        .clone(encounter)
        .map((group) => {
          group.monster = useMonsters().lookup[group.monster.slug];
          if (!group.monster) return false;
          return group;
        })
        .filter(Boolean);
      if (!groups.length) return;
      this.groups = groups;
    },

    loadFromSaved(index) {
      this.loadedLast = false;
      this.loadedIndex = index;
      this.load(this.saved[index]);
      useNotifications().notify({
        title: "Encounter loaded",
        body: this.groups
          .map((group) => `${group.monster.name} x${group.count}`)
          .join(", ")
      });
    },

    deleteSaved(index) {
      if (this.loadedIndex === index) {
        this.loadedIndex = null;
        this.clear();
      }
      this.saved.splice(index, 1);
      useNotifications().notify({ title: "Encounter deleted" });
    },

    clear() {
      this.groups = [];
      this.loadedLast = false;
      this.loadedIndex = null;
    }
  },
  getters: {
    totalExp() {
      return this.groups.reduce(
        (acc, group) => acc + group.monster.cr.exp * group.count,
        0
      );
    },
    totalMonsters() {
      return this.groups.reduce((acc, group) => acc + group.count, 0);
    },
    adjustedExp() {
      return this.totalExp;
    },
    actualDifficulty() {
      return this.getDifficultyFromExperience(this.adjustedExp);
    },
    difficultyFeel() {
      if (!useParty().totalPlayersToGainXP) {
        return "";
      }

      if (this.totalExp === 0) return "";

      const levels = Object.entries(useParty().experience);
      for (let i = 1; i < levels.length; i++) {
        const [lowerKey, lowerValue] = levels[i - 1];
        const [upperKey, upperValue] = levels[i];
        const ratio = helpers.ratio(lowerValue, upperValue, this.totalExp);

        if (ratio >= 10) {
          return "... what.";
        }

        if (upperKey === "daily" && ratio >= 0.0) {
          if (ratio >= 0.2) {
            return ratio >= 1.0
              ? "like " +
              helpers.randomArrayElement(this.insaneDifficultyStrings)
              : ratio >= 0.6
                ? "extremely deadly"
                : "really deadly";
          }
          return lowerKey;
        } else if (ratio >= 0.0 && ratio <= 1.0) {
          if (ratio > 0.7) {
            return upperKey;
          }
          return lowerKey;
        }
      }

      const ratio = helpers.ratio(0, levels[0][1], this.adjustedExp);
      return ratio > 0.5 ? "like a nuisance" : "like a minor nuisance";
    },
    threat() {
      const totalPlayers = useParty().totalPlayers;
      const experience = useParty().experience;
      const mediumExp = experience.medium;
      let singleMultiplier = 1;
      let pairMultiplier = 1.5;
      let groupMultiplier = 2;
      let trivialMultiplier = 2.5;

      if (totalPlayers < 3) {
        // For small groups, increase multiplier
        singleMultiplier = 1.5;
        pairMultiplier = 2;
        groupMultiplier = 2.5;
        trivialMultiplier = 3;
      } else if (totalPlayers > 5) {
        // For large groups, reduce multiplier
        singleMultiplier = 0.5;
        pairMultiplier = 1;
        groupMultiplier = 1.5;
        trivialMultiplier = 2;
      }

      return {
        deadly: Math.floor(experience.deadly / singleMultiplier),
        hard: Math.floor(experience.hard / singleMultiplier),
        medium: Math.floor(mediumExp / singleMultiplier),
        easy: Math.floor(experience.easy / singleMultiplier),
        pair: Math.floor(mediumExp / (2 * pairMultiplier)),
        group: Math.floor(mediumExp / (4 * groupMultiplier)),
        trivial: Math.floor(mediumExp / (8 * trivialMultiplier))
      };
    }
  }
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useEncounter, import.meta.hot));
}

export function getExp(party, level) {
  let partyLevel = party.groups[0].level;
  const diff = level - partyLevel;
  switch (true) {
    case diff < -4:
      return 0;
    case diff === -4:
      return 10;
    case diff === -3:
      return 15;
    case diff === -2:
      return 20;
    case diff === -1:
      return 30;
    case diff === 0:
      return 40;
    case diff === 1:
      return 60;
    case diff === 2:
      return 80;
    case diff === 3:
      return 120;
    case diff === 4:
      return 160;
    case diff === 5:
      return 240;
    case diff >= 6:
      return 300;
  }
  return 0;
}
