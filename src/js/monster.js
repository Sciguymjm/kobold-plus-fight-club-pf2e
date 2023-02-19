import CONST from "./constants.js";
import * as helpers from "./helpers.js";
import { useSources } from "../stores/sources";
import { getExp } from "../stores/encounter";
import { useParty } from "../stores/party";

const sizeTraits = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
export default class Monster {
  constructor(attributes) {
    this.attributes = attributes;
    this.cr = {
      numeric: attributes.level,
      string: attributes.level.toString(),
      get exp() {
        const party = useParty();
        return getExp(party, this.numeric);
      }
    };

    this.name = attributes.name;
    this.type = attributes.type;
    // find first trait that matches a size
    this.size = attributes.traits && this.getSize(attributes);
    this.hp = attributes.hp;
    this.environment = "";
    this.isUnique = !!attributes["unique?"] || !!attributes["unique"];
    this.lair = !!attributes["lair"] || !!attributes["lair?"];

    this.slug = helpers.slugify(
      attributes.name + "-" + attributes.sources + "-" + this.cr.string
    );

    this.tags = attributes.tags
      ? attributes.tags.split(/\s*,\s*/).sort()
      : null;

    this.special = !!attributes.special;
    this.legendary = !!attributes.legendary;
    this.unique = !!attributes.unique;
    this.alignment = attributes.alignment
      ? Monster.parseAlignment(attributes.alignment)
      : "";

    this.searchable = [
      this.name,
      this.attributes.section,
      this.attributes.type,
      this.attributes.size,
      this.attributes.alignment ? this.alignment.text : "",
      this.cr.string,
    ]
      .concat(this.tags)
      .join("|")
      .toLowerCase();

    const sources = useSources();
    this.sources = [attributes.source].map((str) => {
      let book = str;
      let location = "";
      let hasPageNumber = false;

      if (str.includes(": ")) {
        const colonIndex = str.lastIndexOf(": ");
        const afterColon = str.slice(colonIndex + 2);

        hasPageNumber = !isNaN(afterColon);

        if (hasPageNumber || helpers.isValidHttpUrl(afterColon)) {
          book = str.slice(0, colonIndex);
          location = afterColon;
        }
      }

      let reference = {
        shortname: str
      };

      return {
        actual_source: {
          enabled: true
        },
        reference: {
          ...reference,
          ...(helpers.isValidHttpUrl(location) && { link: location }),
        },
        fullText: str + " page " + attributes.page
      };
    });

    this.sources.sort((a, b) =>
      a.fullText.localeCompare(b.fullText, "en", { sensitivity: "base" })
    );
  }

  getSize(attributes) {
    return attributes.traits.find((trait) => {
      return sizeTraits.includes(trait);
    });
  }

  getExp(party) {
    const level = this.cr.numeric;
    return getExp(party, level);
  }

  get sourceEnabled() {
    return this.sources.find((source) => source.actual_source.enabled);
  }

  static parseAlignment(str = "") {
    return {
      string: str,
      bits: str.split(/\s*(,|or|,\s*or)\s*/i).reduce((total, alignment) => {
        return (
          total |
          (CONST.ALIGNMENT_TEST_ORDER.find(function (alignmentDefinition) {
            return alignment.match(alignmentDefinition.regex);
          })?.bits ?? CONST.ALIGNMENTS.UNALIGNED.bits)
        );
      }, 0),
    };
  }
}
