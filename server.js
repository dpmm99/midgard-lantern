const express = require('express')
const qrcode = require('qrcode')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
const shared = require('./shared.js');
const app = express()
const port = 3000

app.use('/assets', express.static('assets')) //Map the 'assets' folder to the '/assets' URL
app.use(cookieParser())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

const htmlHeader = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: gap: 'unsafe-inline'; script-src 'self' 'unsafe-inline';">
  <title>Norse Mythology Adventure RPG</title>
  <link rel="stylesheet" type="text/css" href="style.css">
  <script src="/shared.js"></script>
</head>`;

//Region: the game itself
function clone(obj) {
  const newObject = Object.assign(Object.create(Object.getPrototypeOf(obj)), obj);
  
  //I don't want to deep copy everything, just arrays directly belonging to that object, because this is just for cloning templates like Entity and Ability.
  for (let key in newObject) {
    if (Array.isArray(newObject[key])) newObject[key] = [...newObject[key]];
  }
  
  return newObject;
}

function wordList(words) {
  if (words.length == 0) return "";
  else if (words.length == 1) return words[0];
  else if (words.length == 2) return `${words[0]} and ${words[1]}`;
  else return words.slice(0, words.length - 1).join(', ') + `, and ${words[words.length - 1]}`;
}

class Game {
  constructor() {
    this.users = []
    this.started = false;
    this.driver = null;
    this.logs = []
    this.log = (message) => this.logs.push(message)
    const defaultXpMap = [0, 0, 0, 5, 9]; //Amount of XP you need before you can obtain your <1+index>th ability
    this.playerSelectableSpecies = [
      new Species("Tourist", 25, 25, defaultXpMap, "A classic tourist. Bold and energetic...maybe too much."),
      new Species("Senior", 25, 20, defaultXpMap, "An older person. Experienced, but lower energy than your average tourist."),
      new Species("Nerd", 20, 20, defaultXpMap, "A homebody, lower energy and probably weaker than the norm."),
    ];
    this.playerSelectableAbilities = [
      //Parameters: name, target, multi, usesPerBattle, energyCost, effect, buffEffect(abil, targ, hurt|heal|drain|rest|attack|help [string], amount), buffRounds = 1, description, limitToSpeciesName, minXP, useCondition(self, target [null for prechecks])
      //Starter: one enemy attack
      new Ability("Punch", "foe", false, "infinity", 3, (self, target, abil) => { target.hurt(3, self); }, null, null, "Extend your extremity extremely quickly."),
      //Starter: self heal
      new Ability("Bandage", "self", false, 1, 3, (self, target, abil) => { self.heal(12, self); }, null, null, "Kiss your boo-boos mid-battle. Maybe if you close your eyes, the enemies can't see you.", undefined, undefined, (self) => self.health < self.maxHealth),
      //Starter: self +energy
      new Ability("Breathe", "self", false, "infinity", 0, (self, target, abil) => { self.rest(8); }, null, null, "Stand there during the fight like a dummy and take a deeeeep breath.", undefined, undefined, (self) => self.energy < self.maxEnergy),
      //Nerd starter: all ally defense
      new Ability("Insight", "friend", true, "infinity", 8, (self, target, abil) => { },
        (abil, targ, type, amount) => { return type == 'hurt' ? Math.ceil(amount / 2) : amount; }, 2, "Stand back and watch like a true introvert, but warn your friends when they need to dodge.", "Nerd", 0),
      //Nerd mid: all ally +energy
      new Ability("Energize", "friend", true, "infinity", 5, (self, target, abil) => { target.rest(3); }, null, null, "Motivate everyone to dig deep while you stand and watch.", "Nerd", 5),
      //Nerd end: one enemy strong attack
      new Ability("Magic Missile", "foe", false, "infinity", 5, (self, target, abil) => { target.hurt(7); }, null, null, "Get fully immersed in the role and use magic to attack an enemy.", "Nerd", 9),
      //Senior starter: one ally offense
      new Ability("Wit", "friend", false, "infinity", 6, (self, target, abil) => { },
        (abil, targ, type, amount) => { return type == 'attack' ? Math.ceil(amount * 1.5) : amount; }, 3, "Show an ally how to cleverly go for the weak spots.", "Senior", 0),
      //Senior mid: self defense
      new Ability("Hunker Down", "self", false, "infinity", 5, (self, target, abil) => { },
        (abil, targ, type, amount) => { return type == 'attack' ? Math.ceil(amount / 2) : amount; }, 3, "Wisdom comes with age: take cover so you take less damage for a while.", "Senior", 5),
      //Senior end: all ally weak heal
      new Ability("Wisdom", "friend", true, "infinity", 4, (self, target, abil) => { target.heal(5, self); }, null, null, "Share your wisdom by tending to your allies' wounds.", "Senior", 9),
      //Tourist starter: one enemy -defense & weak attack
      new Ability("Charm", "foe", false, "infinity", 6, (self, target, abil) => { target.hurt(2, self); },
        (abil, targ, type, amount) => { return type == 'hurt' ? Math.ceil(amount * 1.5) : amount; }, 3, "Be so flashy that it makes an enemy drop its guard. Also slap them for good measure.", "Tourist", 0),
      //Tourist mid: all enemy -offense & weak attack
      new Ability("Screech", "foe", true, "infinity", 5, (self, target, abil) => { target.hurt(1, self); },
        (abil, targ, type, amount) => { return type == 'attack' ? Math.ceil(amount / 2) : amount; }, 3, "Annoy the enemies until they deal less damage because they can't focus. Also hurts their ears.", "Tourist", 5),
      //Tourist end: all enemy attack
      new Ability("Karen", "foe", true, "infinity", 7, (self, target, abil) => { target.hurt(4, self); }, null, null, "Make a scene by flailing around violently, striking all enemies.", "Tourist", 9),
    ]
    for (let ability of this.playerSelectableAbilities) ability.log = this.log; //because I don't want yet another constructor parameter every single time
  }

  getPlayer(name) {
    return this.driver?.getPlayer(name);
  }
  
  getStory() {
    const storyElement = this.driver.getCurrentStory()
    if (!storyElement) return;
    return { chapterTitle: storyElement.chapterTitle, location: storyElement.location, storyText: storyElement.storyText, imageFilename: storyElement.imageFilename };
  }
  
  isPlayerBattleTurn(player) {
    return this.isInBattle() && this.driver.getCurrentBattle().isCurrentTurn(player);
  }
  
  getBattleOptions(player) { //TODO: Rewrite this function less terribly
    return this.driver?.getBattleOptions(player) ?? [];
  }
  
  getPlayers() { //Partial data, for UI display purposes
    return this.driver.getCurrentBattle().players.map(p => ({ name: p.name, species: p.species, health: p.health, maxHealth: p.maxHealth, energy: p.energy, maxEnergy: p.maxEnergy, buffs: p.activeEffects.map(q => ({ name: q.ability.name, remainingDuration: q.remainingDuration })) }))
  }
  
  getEnemies() { //Partial data, for UI display purposes
    return this.driver.getCurrentBattle().enemies.map(p => ({ name: p.name, species: p.species, health: p.health, maxHealth: p.maxHealth, energy: p.energy, maxEnergy: p.maxEnergy, buffs: p.activeEffects.map(q => ({ name: q.ability.name, remainingDuration: q.remainingDuration })) }))
  }
  
  setPlayerSpecies(player, species) { //TODO: make this kind of code consistent
    if (player.species === "None") {
      player.setSpecies(this.getSpecies(species))
      this.log(`${player.name} chose ${species}.`);
    }
  }
  
  getNewAbilityOptions(player) {
    return this.playerSelectableAbilities.filter(p => player.canTake(p));
  }
  
  getNewAbilitiesNeeded(player) {
    return player.getNewAbilitiesNeeded();
  }
  
  grantAbility(player, ability) {
    //Cloned because it has state info that varies per-entity
    if (typeof ability === "number") ability = clone(this.playerSelectableAbilities[ability]) //Unused right now
    else ability = clone(this.playerSelectableAbilities.find(p => p.name === ability))
    this.driver.grantAbility(player, ability)
  }
  
  isInBattle() {
    return this.driver.currentBattleIndex >= 0;
  }
  
  getSpecies(species) {
    return this.playerSelectableSpecies.find(p => p.name === species)
  }
  
  addUser(name) {
    if (!this.users.includes(name)) {
      this.users.push(name)
    }
  }

  removeUser(name) {
    this.users = this.users.filter(user => user !== name)
    const player = this.driver?.getPlayer(name);
    if (player) {
      player.maxHealth = player.health = 0; //So they'll be skipped in all battles
      const battle = this.driver.getCurrentBattle();
      if (battle?.isCurrentTurn(player)) battle.act(); //Skip that player if it was their turn
    }
  }

  getUsers() {
    return this.users;
  }
  
  start() {
    this.started = true
    this.driver = new GameDriver(this.buildStoryElements(), this.users, this.log)
    this.driver.startGame();
  }
  
  isHost(name) {
    return this.users[0] === name;
  }
  
  buildStoryElements() {
    //Abilities
    const punch = new Ability("Punch", "foe", false, "infinity", 3, (self, target, abil) => { target.hurt(3, self); })
    const crash = new Ability("Crash", "foe", false, 1, 0, (self, target, abil) => { target.hurt(5, self); self.hurt(99, self); }) //Destroys itself on impact
    const burn = new Ability("Burn", "foe", false, "infinity", 3, (self, target, abil) => { target.hurt(7, self); })
    const slam = new Ability("Slam", "foe", false, "infinity", 6, (self, target, abil) => { target.hurt(8, self); })
    const magicShield = new Ability("Magic Shield", "friend", true, 2, 5, (self, target, abil) => { },
      (abil, targ, type, amount) => { return type == 'hurt' ? Math.ceil(amount / 2) : amount; }, 3) //50% defense buff for 3 rounds
    const uppercut = new Ability("Uppercut", "foe", false, "infinity", 4, (self, target, abil) => { target.hurt(5, self); })
    const slash = new Ability("Slash", "foe", true, "infinity", 7, (self, target, abil) => { target.hurt(4, self); })
    const confuse = new Ability("Confuse", "foe", false, "infinity", 0, (self, target, abil) => { target.hurt(4, self); }) //You hurt yourself in your confusion!
    const perplex = new Ability("Perplex", "foe", false, "infinity", 0, (self, target, abil) => { target.hurt(6, self); })
    const malfunction = new Ability("Malfunction", "foe", false, "infinity", 0, (self, target, abil) => { target.hurt(3, self); self.hurt(3, self); })
    const toxify = new Ability("Toxify", "foe", true, "infinity", 3, (self, target, abil) => { target.hurt(3, self); },
      (abil, targ, type, amount) => { return type == 'attack' ? Math.ceil(amount / 2) : amount; }, 2) //Hurts AND 50% damage debuff for 2 rounds
    const bandage = new Ability("Bandage", "self", false, 1, 4, (self, target, abil) => { self.heal(8, self); }, undefined, undefined, undefined, undefined, undefined, (self) => self.health < self.maxHealth)
    const breathe = new Ability("Breathe", "self", false, "infinity", 0, (self, target, abil) => { self.rest(5); }, undefined, undefined, undefined, undefined, undefined, (self) => self.energy < self.maxEnergy)
    const breatheDeep = new Ability("Breathe Deep", "self", false, "infinity", 0, (self, target, abil) => { self.rest(9); }, undefined, undefined, undefined, undefined, undefined, (self) => self.energy < self.maxEnergy)
    const absorbMaterial = new Ability("Absorb Material", "self", false, "infinity", 5, (self, target, abil) => { self.heal(14, self); }, undefined, undefined, undefined, undefined, undefined, (self) => self.health < self.maxHealth)
    
    for (let ability of [punch, crash, burn, slam, magicShield, uppercut, slash, confuse, perplex, malfunction, toxify, bandage, breathe, breatheDeep, absorbMaterial]) ability.log = this.log;
    
    //Enemies
    const hostileSpirit = new Entity("Embodiment of Hostility", "Spirit", 8, 6, [punch, breathe])
    const defenseSpirit = new Entity("Embodiment of Defense", "Spirit", 14, 8, [magicShield, breathe])
    const violentSpirit = new Entity("Embodiment of Violence", "Spirit", 10, 8, [punch, burn, breathe])
    const giant = new Entity("Giant", "Giant", 20, 10, [punch, slam, breathe])
    const volcanicRock = new Entity("Rock", "Volcanic Debris", 6, 0, [crash])
    const volcanicAsh = new Entity("Ash", "Volcanic Debris", 12, 9, [toxify])
    const volcanicLava = new Entity("Lava", "Volcanic Debris", 4, 30, [burn])
    const einheri = new Entity("Warrior", "Einheri", 28, 20, [uppercut, slash, bandage, breatheDeep])
    const riddle = new Entity("Riddle", "Puzzle", 10, 99, [bandage, bandage, confuse, perplex])
    const puzzle = new Entity("Puzzle", "Puzzle", 12, 99, [bandage, bandage, bandage, confuse, perplex, malfunction])
    const primordial = new Entity("Shapeless Form", "Primordial Being", 40, 99, [slash, toxify, breathe, absorbMaterial])
    
    //StoryElements
    return [
      new StoryElement(`The Missing Gods`, `Present-day Midgard`, `The world around you is in chaos. Natural disasters are rampant, and society teeters on the brink of collapse. In the heart of a desolate city, you—who are Vættir, spirits of nature and guardians of the ancient forests—gather around the Elder Seer, a revered sage with eyes that have seen too much. He reveals that the gods have mysteriously vanished, leaving Midgard to its fate. Without their divine guidance, the end seems inevitable. The Seer tells you that you must embark on a perilous journey through time to influence the old gods' decisions and restore balance. As the Seer performs a ritual to send you back in time, you feel the weight of your responsibility settle upon your shoulders.`, undefined, "TheMissingGods.png"),
      new StoryElement(`Decision to Travel Back`, `Sacred Grove in Midgard`, `In the Sacred Grove, an ancient and mystical forest, you and your fellow Vættir listen intently to the Elder Seer’s final instructions. "The journey will be fraught with danger," he warns. "Various spirits and creatures will sense your sudden appearance, and the timestream itself will resist your influence. You will find yourselves in random locations and times until you reach the intended time and place." With a solemn vow, you commit to the quest. As the Seer chants ancient incantations, a portal to the past begins to form, shimmering with otherworldly light. Stepping through, you brace yourselves for the unknown.`, undefined, "DecisionToTravelBack.png"),
      new StoryElement(`The Journey Begins`, `Prehistoric Midgard`, `You find yourselves in a lush, untamed version of Midgard, far removed from the chaos of your time. The air is thick with the magic of an untouched world. As you explore, at first, ancient spirits greet you with curiosity and kindness. These spirits, remnants of a time before the gods' influence, offer guidance and share their knowledge of the ancient world. You learn to navigate this prehistoric landscape, preparing for the challenges that lie ahead.`, undefined, "TheJourneyBegins.png"),
      new StoryElement(`Malevolent Encounter`, `Ancient Midgard Forest`, `As you delve deeper into the ancient forest, you sense a malevolent presence. Shadows flicker among the trees, and the air grows colder. Suddenly, you are ambushed by hostile spirits—remnants of those who opposed the gods in ancient times. Twisted by their defiance, these spirits are determined to thwart your mission. The stage is set for your first battle, a test of your resolve and combat prowess.`, [
        new Battle(this.log, [hostileSpirit, hostileSpirit]),
      ], "MalevolentEncounter.png"),
      new StoryElement(`Meeting the Ancients`, `Svartalfheim`, `After overcoming your foes, you arrive at the entrance to an ancient underground settlement, Svartalfheim. The wise dvergr, also called dwarves or perhaps dark elves, welcome you and share stories of the world's creation and the early days of the gods. They provide crucial clues about the next leap through time, emphasizing the importance of understanding the past to shape the future. They then usher you through a portal of their own design.`, undefined, "MeetingTheAncients.png"),
      new StoryElement(`Leap to Vanaheim`, `Vanaheim`, `Your journey continues as you leap to Vanaheim, the verdant realm of the Vanir gods. Off in the distance, golden fields of barley sway beneath a sky painted with the hues of dawn and dusk, outlining your destination—the Vanir Temple. Shortly after setting off, however, you are met with hostile spirits, as was foretold.`, [
        new Battle(this.log, [hostileSpirit, hostileSpirit, hostileSpirit]),
      ], "LeapToVanaheim.png"),
      new StoryElement(`The Vanir's Task`, `Vanir Temple`, `In the sacred temple in Vanaheim, you meet Njord, Freyr, and Freyja, deities associated with fertility, prosperity, and nature. The Vanir gods explain the history of their realm and the delicate balance they maintain. They ask you to prove your worthiness by gathering rare magical herbs for a ritual to send you on through time. For this, you venture into the deepest parts of the forest. The moment you spot the herbs, violent spirits come to keep them from your grasp, testing your resolve.`, [
        new Battle(this.log, [violentSpirit, violentSpirit, defenseSpirit]),
      ], "TheVanirsTask.png"),
      new StoryElement(`Vanir's Blessing`, `Vanir Temple`, `Having successfully defeated the spirits, and with the magical herbs in tow, you return to the Vanir Temple. The Vanir gods are impressed with your courage and dedication. They ceremoniously bless you, infusing you with the strength and wisdom needed for your next leap. The ritual opens a new portal, guiding you to Asgard, the realm of the Aesir gods.`, undefined, "VanirsBlessing.png"),
      new StoryElement(`Aesir's Challenge`, `Asgard`, `You arrive in Asgard, a realm of magnificent halls and divine power. Odin, Thor, and Frigg greet you, explaining the cosmic balance that the Aesir strive to maintain. The Aesir gods recognize the importance of your mission and agree to help, but first, you must prove your valor in the Hall of Valhalla, where only the bravest warriors reside. These combat trials against seasoned warriors will test your strength and teamwork. At the same time, they are a lesson in the values upheld by the Aesir—bravery, honor, and wisdom in battle.`, [
        new Battle(this.log, [einheri]), new Battle(this.log, [einheri]), new Battle(this.log, [einheri]),
      ], "AesirsChallenge.png"),
      new StoryElement(`Victory and Wisdom`, `Hall of Valhalla`, `Emerging victorious from the trials, you earn the respect of the Aesir gods. Odin, impressed by your valor, shares profound secrets about the timeline and the interconnectedness of all realms. This knowledge sheds light on the origins of the current crisis and the steps needed to restore balance. The gods send you, empowered and enlightened, on your way to Alfheim.`, undefined, "VictoryAndWisdom.png"),
      new StoryElement(`Leap to Alfheim`, `Alfheim`, `You arrive in Alfheim, the luminous realm of the Light Elves. The elves, known for their wisdom and mastery of light magic, welcome you and teach you about the ancient connection between the elves and the gods, and how their combined efforts once shaped the destiny of the realms. Suddenly, the elves begin to fall as the sacred oak trees linked to their lives are attacked by spirits of chaos. You rush to their defense.`, [
        new Battle(this.log, [hostileSpirit, hostileSpirit, violentSpirit, defenseSpirit]), 
      ], "LeapToAlfheim.png"),
      new StoryElement(`Elven Trial`, `Elven Grove`, `To earn the guidance of the Light Elves, since you merely handled the attack that your own presence caused, you must solve a series of riddles that test your knowledge of Norse myths and your ability to think critically. Each riddle reveals a piece of the larger puzzle, helping you understand the complexities of the past and the subtle forces at play in your quest.`, [
        new Battle(this.log, [riddle, riddle, riddle]), 
      ], "ElvenTrial.png"),
      new StoryElement(`Elven Guidance`, `Elven Grove`, `Having successfully solved the riddles, the Light Elves reveal a hidden path that leads to the next leap in time. They provide you with a magical portal that will take you to Jotunheim, the land of the giants. The elves emphasize the importance of understanding the giants' perspective, as their role in the world's creation is crucial to your mission.`, undefined, "ElvenGuidance.png"),
      new StoryElement(`Leap to Jotunheim`, `Jotunheim`, `You find yourselves in the rugged and imposing realm of Jotunheim, home to the giants. Initially met with hostility, you must prove your intentions and strength to the giants. These ancient beings of immense power hold vital knowledge about the world's creation and the primordial forces that shaped it.`, [
        new Battle(this.log, [giant, giant, giant, giant]), 
      ], "LeapToJotunheim.png"),
      new StoryElement(`Giant's Wisdom`, `Giant’s Fortress`, `The giants, convinced of your purpose, bring you to their elders, who share their ancient knowledge about the creation of the world and the primordial void, Ginnungagap. This wisdom provides you with a deeper understanding of the cosmic forces at play and the significance of your mission. Awaiting your next leap through time, you continue honing your strength with the help of the giants.`, [
        new Battle(this.log, [giant, giant, giant, giant]), 
      ], "GiantsWisdom.png"),
      new StoryElement(`Trial by Fire`, `Muspelheim`, `You arrive in Muspelheim, the blazing realm of the fire giants. The intense heat and volcanic landscape test your resilience. You meet with the fire giants, who point to their own time portal across a field of erupting volcanoes, leading to another a grueling trial of endurance that challenges your determination.`, [
        new Battle(this.log, [volcanicRock, volcanicLava]), new Battle(this.log, [volcanicAsh, volcanicRock, volcanicRock]),
      ], "TrialByFire.png"),
      new StoryElement(`Trial by Ice`, `Niflheim`, `Diving through the portal, you find yourselves in the icy realm of Niflheim, a stark contrast to Muspelheim and a pleasant surprise. After recovering, you head for the nearest sign of life. There, the ice giants, rulers of this frozen domain, challenge you with a complex puzzle. Located on a vast frozen lake, the puzzle is a test of logic and knowledge, revealing hidden truths about the primordial forces.`, [
        new Battle(this.log, [puzzle, puzzle, puzzle, puzzle]),
      ], "TrialByIce.png"),
      new StoryElement(`Slipping Through Time`, `Frozen Lake`, `As you complete the puzzle, the world around you begins to blur, and you feel yourself being shifted through time once more.`, undefined, "SlippingThroughTime.png"),
      new StoryElement(`Alteration Altercation`, `Ginnungagap`, `You arrive at the heart of Ginnungagap, the primordial void from which all creation emerged. Here, you encounter enigmatic entities that evolved into the first gods and who embody the raw, untamed forces of the universe. You must confront these beings to influence the gods' decisions at the dawn of time, obviously through more glorious combat. Your success here will determine the fate of Midgard and the gods themselves.`, [
        new Battle(this.log, [primordial, primordial]), 
      ], "AlterationAltercation.png"),
      new StoryElement(`Butterfly Effect`, `Ginnungagap`, `By influencing the primordial beings, you have successfully altered the path that the old gods would take. This meager moment ripples through time, altering the fabric of reality. As you prepare for the final leap back to the present, you hope your actions have restored balance and prevented the looming disaster.`, undefined, "ButterflyEffect.png"),
      new StoryElement(`World on Fire`, `Present-day Midgard`, `You return to present-day Midgard, finding a world transformed by your actions. The gods have returned, but you soon realize that your efforts have accelerated the destruction of the modern world. The Elder Seer reveals with a cackle that the chaos was part of his grand scheme, for he was Loki, the infamous trickster god. Though initially deceived, you reflect on your journey and the importance of your role as guardians of the ancient world. You vow to continue protecting Midgard, now armed with the wisdom and strength gained from your epic quest, as you begin to pummel Loki for wasting your time before returning to the portal. What a jerk.`, undefined, "WorldOnFire.png"),
    ];
  }
}

class Species {
  constructor(name, health, energy, xpMap, description) {
    this.name = name;
    this.health = health;
    this.energy = energy;
    this.xpMap = xpMap;
    this.description = description;
  }
}

class StoryElement {
  constructor(chapterTitle, location, storyText, battles = [], imageFilename = null) {
    this.chapterTitle = chapterTitle;
    this.location = location;
    this.storyText = storyText;
    this.battles = battles; // List of Battle instances
    this.imageFilename = imageFilename; // Optional image filename
    this.readyPlayers = new Set();
  }
}

class Entity {
  constructor(name, species, health, energy, abilities) {
    this.name = name;
    this.species = species;
    this.maxHealth = this.health = health;
    this.maxEnergy = this.energy = energy;
    this.xp = 0;
    this.xpMap = [];
    this.abilities = abilities.map(clone); // List of Ability instances--cloned because they have state info that matters per-entity
    this.activeEffects = []; // List of ActiveEffect instances
  }

  setSpecies(species) {
    this.species = species.name
    this.maxHealth = this.health = species.health
    this.maxEnergy = this.energy = species.energy
    this.xpMap = species.xpMap
  }

  needsAnAbility() { //Meets the requirements to obtain the next ability
    if (this.abilities.length >= this.xpMap.length) return false; //No more to grant
    const nextXpRequirement = this.xpMap[this.abilities.length]
    return this.xp >= nextXpRequirement;
  }

  getNewAbilitiesNeeded() { //Count how many abilities the player needs to pick to catch up with their current XP
    let count = 0;
    while (this.abilities.length + count < this.xpMap.length && this.xp >= this.xpMap[this.abilities.length + count]) count++;
    return count;
  }

  canTake(ability) {
    return (!ability.speciesRestriction || ability.speciesRestriction === this.species) && //The right species
      !this.abilities.find(p => p.name === ability.name) && //Not already obtained
      this.xp >= ability.xpRequirement //Has enough XP
  }

  grantAbility(ability) {
    this.abilities.push(clone(ability))
  }

  //The below should all apply only during battles.
  //Amount of damage/healing/energy drain/energy restoration. If ignoreBuffs, this function returns the original amount. The last parameter is what the amount is doing (a string from the below functions).
  modifyAmount(amount, ignoreBuffs, activity) {
    if (ignoreBuffs) return amount;
    const self = this;
    this.activeEffects.forEach(p => amount = p.ability.buffEffect(p, self, activity, amount))
    return amount;
  }

  //Health
  hurt(amount, byEntity, ignoreBuffs = false) {
    if (byEntity) amount = byEntity.modifyAmount(amount, ignoreBuffs, 'attack')
    amount = this.modifyAmount(amount, ignoreBuffs, 'hurt')
    this.health = Math.max(0, this.health - amount)
  }

  heal(amount, byEntity, ignoreBuffs = false) {
    if (byEntity) amount = byEntity.modifyAmount(amount, ignoreBuffs, 'help')
    amount = this.modifyAmount(amount, ignoreBuffs, 'heal')
    this.health = Math.min(this.maxHealth, this.health + amount)
  }
  
  //Energy
  drain(amount, byEntity, ignoreBuffs = false) {
    if (byEntity) amount = byEntity.modifyAmount(amount, ignoreBuffs, 'steal')
    amount = this.modifyAmount(amount, ignoreBuffs, 'drain')
    this.energy = Math.max(0, this.energy - amount)
  }

  rest(amount, byEntity, ignoreBuffs = false) {
    if (byEntity) amount = byEntity.modifyAmount(amount, ignoreBuffs, 'feed')
    amount = this.modifyAmount(amount, ignoreBuffs, 'rest')
    this.energy = Math.min(this.maxEnergy, this.energy + amount)
  }
  
  applyBuff(ability) {
    if (!ability.buffEffect) return;
    this.activeEffects.push(new ActiveEffect(ability));
  }
  
  combatReset() {
    //reset usesRemaining on the abilities
    this.abilities.forEach(p => p.resetUses());
    this.activeEffects = [];
    this.health = this.maxHealth;
    this.energy = this.maxEnergy;
  }
  
  //For simplicity, all buffs and debuffs last until the start of the buffed/debuffed entity's turn (self-buffs last 1 full round minimum; other-buffs can last less than one round)
  startTurn() {
    for (var x = this.activeEffects.length - 1; x >= 0; x--) {
      if (--this.activeEffects[x].remainingDuration <= 0) this.activeEffects.splice(x, 1);
    }
  }
}

class ActiveEffect {
  constructor(ability) {
    this.ability = ability; // Reference to an Ability instance
    this.remainingDuration = ability.buffRounds;
  }
}

class Ability {
  constructor(name, target, multi, usesPerBattle, energyCost, effect, buffEffect = null, buffRounds = 1, description = "", speciesRestriction = null, xpRequirement = 0, useCondition = null) {
    this.name = name;
    this.description = description;
    this.effect = effect; // Effect function to execute, with parameters (self, target, this ability)
    this.energyCost = energyCost;
    this.buffEffect = buffEffect; //Effect function to execute if the ability is applied as a buff/debuff, with parameters (originatingAbility, buffedEntity, 'hurt' or 'heal' or 'drain' or 'rest' or 'attack' or 'help', amount); returns the modified amount
    this.buffRounds = buffRounds; //Number of rounds the buff/debuff should last, if buffEffect is provided
    this.target = target; // 'friend', 'foe', 'self'
    this.multi = target != 'self' && multi; // true or false
    this.usesPerBattle = usesPerBattle; // Number of times it can be used per battle
    this.speciesRestriction = speciesRestriction; // Null or specific species
    this.xpRequirement = xpRequirement; // XP needed to unlock
    this.usesRemaining = usesPerBattle; // Track remaining uses in battle
    this.useCondition = useCondition ?? function(){return true}; //Parameters are self, target. The latter is a list of entities if multi is true, and it WILL be null sometimes regardless.
  }

  use(self, target) {
    if (!this.canUse(self, target)) return;
    if (this.usesPerBattle != 'infinity') this.usesRemaining--;
    if (this.energyCost) self.drain(this.energyCost);
    
    if (this.multi) {
      for (var entity of target) this.applyEffect(self, entity);
    } else this.applyEffect(self, target);
  }

  applyEffect(self, target) {
    const wasAlive = target.health > 0; //Detect when an entity is defeated
    this.effect(self, target, this);
    target.applyBuff(this);
    if (wasAlive && target.health <= 0 && this.log) this.log(`${target.name} was defeated by ${self.name}!`);
  }

  resetUses() {
    this.usesRemaining = this.usesPerBattle;
  }
  
  canUse(self, target) { //Target will be null in some circumstances!
    return (this.usesPerBattle === 'infinity' || this.usesRemaining > 0) && self.energy >= this.energyCost && this.useCondition(self, target);
  }
}

class Battle {
  constructor(log, enemies) {
    this.log = log;
    this.players = [];
    this.enemies = this.numberTheNames(enemies.map(clone)); // List of Entity instances--cloned because they have state
	this.enemies.forEach(p => p.abilities = p.abilities.map(clone)); //Slightly deeper clone because the abilities carry state, and I used the same Entity objects for various battles
    this.currentTurn = 0; // Whose turn it is
  }

  numberTheNames(enemies) {
    const nameCount = {};
    enemies.forEach(enemy => {
      if (nameCount[enemy.name] === undefined) {
        nameCount[enemy.name] = 1;
      } else {
        if (nameCount[enemy.name] === 1) enemies.find(e => e.name === enemy.name).name += ' 1'; //When we find the second case, put a 1 on the first such enemy
        enemy.name += ' ' + (++nameCount[enemy.name]);
      }
    });
    return enemies;
  }

  start(players) {
    this.players = players;
    this.started = true;
  }

  nextTurn() {
    this.currentTurn = (this.currentTurn + 1) % (this.enemies.length + this.players.length);
  }

  isLost() {
    return this.players.every(p => p.health <= 0);
  }

  isWon() {
    return this.enemies.every(p => p.health <= 0);
  }
  
  isEnemyTurn() {
    return this.currentTurn >= this.players.length //Players play first
  }
  
  isCurrentTurn(player) {
    return this.currentTurn < this.players.length && player === this.players[this.currentTurn]
  }

  getCurrentTurnEntity() {
    return this.currentTurn < this.players.length 
      ? this.players[this.currentTurn] 
      : this.enemies[this.currentTurn - this.players.length];
  }

  getBattleOptions(player) {
    const playerIndex = this.players.findIndex(p => p === player); //TODO: get better unique identifiers than integers for /act
    const playerCount = this.players.length;
    return player.abilities.filter(ability => ability.canUse(player)).map(ability => {
      if (ability.target == 'self') return { name: ability.name, description: ability.description, energyCost: ability.energyCost, usesRemaining: ability.usesRemaining }; //Leave out the target so the UI knows how to display it
      else if (ability.multi) {
        if (ability.target == 'friend'){
          return { name: ability.name, description: ability.description, energyCost: ability.energyCost, usesRemaining: ability.usesRemaining, target: 'allFriends' };
        } else if (ability.target == 'foe'){
          return { name: ability.name, description: ability.description, energyCost: ability.energyCost, usesRemaining: ability.usesRemaining, target: 'allFoes' };
        }
      } else {
        if (ability.target == 'friend'){
          return this.players.map((p, idx) => ({ name: ability.name, description: ability.description, energyCost: ability.energyCost, usesRemaining: ability.usesRemaining, target: idx, ok: p != player && p.health > 0 && ability.canUse(player, p) })).filter(p => p.ok);
        } else if (ability.target == 'foe'){
          return this.enemies.map((p, idx) => ({ name: ability.name, description: ability.description, energyCost: ability.energyCost, usesRemaining: ability.usesRemaining, target: playerCount + idx, ok: p.health > 0 && ability.canUse(player, p) })).filter(p => p.ok);
        }
      }
    }).flat()
  }

  getEnemyAction() {
    const entity = this.getCurrentTurnEntity();
    const friends = this.enemies.filter(p => p.health > 0 && p != entity);
    const foes = this.players.filter(p => p.health > 0);
    
    const validAbilities = entity.abilities.filter(p => p.canUse(entity) && (friends.length ? true : p.target != 'friend')); //TODO: pass in the team if ability.multi, so we can disallow use of team abilities when it has no teammates
    while (true) { //May have to try multiple times to pick an ability since I'm not checking all abilities against all targets in one fell swoop
      const ability = validAbilities[Math.floor(Math.random() * validAbilities.length)]
      if (!ability) return;

      if (ability.multi) return { ability, target: undefined }; //Affects a whole team
      else if (ability.target === 'self') return { ability, target: entity };
      else {
        const validTargets = (ability.target == 'foe' ? foes : friends).filter(p => ability.canUse(entity, p))
        if (validTargets.length) return { ability, target: validTargets[Math.floor(Math.random() * validTargets.length)] };
        validAbilities.splice(validAbilities.findIndex(p => p == ability), 1);
      }
    }
  }

  handleTurn(action) {
    if (!action) return;
    
    const entity = this.getCurrentTurnEntity();
    if (entity.health <= 0) return; //Can't do anything

    //If ability name or target index is provided, point to the appropriate object instead
    if (typeof action.ability === 'string') action.ability = entity.abilities.find(p => p.name === action.ability);
    //if (typeof action.ability === 'number') action.ability = entity.abilities[action.ability];
    if (typeof action.target === 'number') action.target = action.target < this.players.length ? this.players[action.target] : this.enemies[action.target - this.players.length]
    
    if (action.ability.multi) { //In this case, target must be 'friend' or 'foe'
      const isEnemy = this.enemies.includes(entity)
      const targetsFoe = action.ability.target === 'foe'
      action.target = (isEnemy === targetsFoe ? this.players : this.enemies).filter(p => p.health > 0 && p != entity)
      this.log(`${entity.name} used ${action.ability.name} on ${targetsFoe ? 'all enemies' : 'all allies'}!`);
    } else if (action.ability.target === 'self') {
      action.target = entity;
	  this.log(`${entity.name} used ${action.ability.name}!`);
    }
    else this.log(`${entity.name} used ${action.ability.name} on ${action.target.name}!`);
    
    action.ability.use(entity, action.target);
  }

  act(playerAction) {
    this.handleTurn(playerAction);
    this.nextTurn();
    
	let tries = 0; //Prevent infinite loop just in case I set up a soft-lock situation.
	do {
      //Fast forward through enemy turns
      while (this.isEnemyTurn()) {
        this.getCurrentTurnEntity().startTurn();
        this.handleTurn(this.getEnemyAction());
        this.nextTurn();
      }
      
      //Fast forward through defeated players and players who can't do anything (if we end back up on an enemy turn, the caller has to handle it.)
  	  let currentEntity = null;
  	  let noBattleOptions = false;
      while ((currentEntity = this.getCurrentTurnEntity()).health <= 0 | (noBattleOptions = !this.getBattleOptions(currentEntity).length)) { //This is a single | on purpose. Do not short circuit!
        currentEntity.startTurn();
  	    //Humans with no options get one free energy per turn. Maybe they didn't take the breathe (rest) ability.
  	    if (noBattleOptions && this.currentTurn < this.players.length && currentEntity.energy < currentEntity.maxEnergy) currentEntity.energy++;
        this.nextTurn();
		if (this.isLost() || this.isWon()) break; //I managed to get an infinite loop by having all enemies run out of health as I ran out of energy. :)
      }
    } while (this.currentTurn >= this.players.length && !this.isLost() && !this.isWon() && ++tries < 10); //Enemies keep taking turns until at least one human can.
	
	if (tries >= 100) {
      this.log("It seems no players are able to act even after being given free energy. Please reset the game if nobody has any options. Resetting the player combat attributes as a last resort.");
	  this.players.forEach(p => p.combatReset());
	}
	
    //Start the next player's turn (because buffs/debuffs must wear off BEFORE they make their move)
    this.getCurrentTurnEntity().startTurn();
  }
}

class GameDriver {
  constructor(storyElements, players, log) {
    this.storyElements = storyElements; // List of StoryElement instances
    this.players = players.map(p => new Entity(p, "None", 1, 1, []));
    this.log = log; // A function that accepts a string message parameter
    this.currentStoryIndex = 0;
    this.currentBattleIndex = -1; //-1 is "display the story," and 0+ is an actual battle index.
  }
  
  getPlayer(name) {
    return this.players.find(p => p.name == name)
  }
  
  grantAbility(player, ability) {
    if (player.needsAnAbility() && player.canTake(ability)) {
      player.grantAbility(ability)
      this.log(`${player.name} gained the ${ability.name} ability.`)
    }
  }

  getBattleOptions(player) {
    return this.getCurrentBattle()?.getBattleOptions(player) ?? [];
  }

  startGame() {
    //I don't think I need this function because the constructor is enough
  }

  getCurrentStory() {
    return this.storyElements[this.currentStoryIndex];
  }

  getCurrentBattle() {
    const storyElement = this.getCurrentStory();
    return storyElement.battles[this.currentBattleIndex]
  }

  advance(playerAction) {
    const storyElement = this.getCurrentStory();
    if (!storyElement) return;
    
    if (typeof playerAction.player === 'number') playerAction.player = this.players[playerAction.player]
    if (typeof playerAction.ability === 'string') playerAction.ability = playerAction.player.abilities.find(p => p.name === playerAction.ability);
    
    //Any action that goes through this.advance() outside of battle indicates that player read the story.
    if (this.currentBattleIndex < 0) {
      storyElement.readyPlayers.add(playerAction.player);
      if (!this.players.every(p => storyElement.readyPlayers.has(p))) return; //Keep displaying the story until all players are ready
      this.currentBattleIndex++; //Ready to start the first battle (if there even is one)
    }
    
    //Start or continue the current battle, if there is one and it's the correct player's turn
    if (this.currentBattleIndex < storyElement.battles.length) {
      const battle = this.getCurrentBattle()
      if (!battle.started) {
		this.log(`Battle ensues! Your ${battle.enemies.length == 1 ? "lone opponent is" : "opponents are"} ${wordList(battle.enemies.map(p => p.name))}.`)
		battle.start(this.players); //Just for internal state; shouldn't affect the players/UI, so it doesn't matter that I don't call it immediately after currentBattleIndex++
	  }
      if (!battle.isCurrentTurn(playerAction.player)) return; //Wrong player? Do nothing.
      if (playerAction.ability !== undefined) battle.act(playerAction);
      if (battle.isLost()) {
        this.players.forEach(p => p.combatReset());
        this.log("The battle is lost, but you can't give up. The world needs you! You play dead for a while and get back up after recovering.");
        while (battle.isEnemyTurn()) battle.nextTurn();
        //Should really reset the battle, but eh!
      } else if (battle.isWon()) {
        this.players.forEach(player => player.xp += 1); // Example XP gain
        this.players.forEach(p => p.combatReset());
        this.currentBattleIndex++;
        this.log("The battle is won! You rest and tend to your wounds.")
        if (this.currentBattleIndex < storyElement.battles.length) {
          this.log("But wait--there's more!")
          this.getCurrentBattle().start(this.players);
        }
      }
      
      if (this.currentBattleIndex < storyElement.battles.length) return; //More battles to do or this one is still ongoing! Otherwise, advance the story.
    }
    
    this.currentStoryIndex++;
    this.currentBattleIndex = -1;

    return this.currentStoryIndex >= this.storyElements.length; //Game has ended if true
  }
}

//Region: server backing stuff
let game = new Game()

//from https://stackoverflow.com/a/49664174
const catchErrors = action => (req, res, next) => action(req, res).catch(next)
const devErrorHandler = (err, req, res, next) => {
  err.stack = err.stack || ''
  const status = err.status || 500
  const error = { message: err.message }
  res.status(status)
  res.json({ status, error })
}

app.use(devErrorHandler)

//Region: the APIs
app.get('/share', catchErrors(async (req, res) => {
  const hostWithPort = 'http://' + req.hostname + ':' + port
  const qrCodeDataUrl = await qrcode.toDataURL(hostWithPort)
  res.send('Join the game at ' + hostWithPort + '!<br>\n<img src="' + qrCodeDataUrl + '">')
}))

app.get('/shared.js', catchErrors(async (req, res) => {
  res.sendFile('shared.js', {root: __dirname})
}))

app.get('/style.css', catchErrors(async (req, res) => {
  res.sendFile('style.css', {root: __dirname})
}))

function getPreGamePage(name) {
  const isHost = game.isHost(name);
  return `${htmlHeader}
    <div style="padding: 20px">
    <h2 style='margin-top: 0'>Welcome, ${name}!</h2>
    <h3>Players:</h3>
    <ul id="player-list"><li>Refreshing...</li></ul>
    ${isHost ? `
      <h3>You are the host.</h3>
      <form action="/start" method="POST">
        <button type="submit" style='margin-bottom: 10px;'>Start Game</button>
      </form>
      <a href='/share' target='_new' style='color: white;'>Click to share</a>
    ` : ''}
    <br><br><br>
    <form action="/leave" method="POST">
      <button type="submit">Leave Game</button>
    </form>
    </div>
    <script>
        function reloadPlayerList() {
          fetch('/players')
            .then(response => response.json())
            .then(data => {
              const playerList = document.getElementById('player-list');
              playerList.innerHTML = data.players.map(player => '<li>' + escapeHtml(player) + '</li>').join('');
              if (data.started) {
                window.location.reload(); //The game is ready, so we'll stop watching for players
              }
            });
        }
        reloadPlayerList();
        setInterval(reloadPlayerList, 1000);
    </script>
  `;
}

app.get('/', catchErrors(async (req, res) => {
  let name = req.cookies.username
  if (!name || !game.users.length || (!game.started && !game.users.includes(name))) {
    res.send(`${htmlHeader}
      <form action="/join" method="POST" style="padding: 20px">
        <label for="name">Enter your name:</label>
        <input type="text" id="name" name="name" value="${shared.escapeHtml(req.cookies.username)}" required>
        <button type="submit">Join Game</button>
      </form>
    `)
  } else if (game.started && game.getPlayer(name)) res.sendFile('InGame.html', {root: __dirname})
  else if (game.started) res.send(`${htmlHeader}
    Please wait for this game to finish, then refresh the page.`)
  else res.send(getPreGamePage(name))
}))

app.post('/join', catchErrors(async (req, res) => {
  const name = req.body.name
  if (name) {
    res.cookie('username', name)
    if (!game.started) game.addUser(name)
  }
  res.redirect('/')
}))

app.post('/act', catchErrors(async (req, res) => { //For during-game actions, e.g., saying you've read the story content, choosing an ability to use in battle, or selecting a new ability
  const player = game.getPlayer(req.cookies.username)
  game.driver?.advance({ player, ability: req.body.ability, target: req.body.target }) //TODO: Don't directly access game.driver in the Web part of the code
  res.send('{}')
}))

app.post('/chooseAbility', catchErrors(async (req, res) => { //If the user doesn't have enough abilities for their current XP, they should call this with the ability they want to take
  const player = game.getPlayer(req.cookies.username)
  game.grantAbility(player, req.body.ability)
  res.send('{}')
}))

app.post('/chooseSpecies', catchErrors(async (req, res) => { //For the user to pick their class/archetype
  const player = game.getPlayer(req.cookies.username)
  game.setPlayerSpecies(player, req.body.species)
  res.send('{}')
}))

app.get('/gameState', catchErrors(async (req, res) => { //Show the user one screen; in order of descending priority: character select, ability select, battle, story
  const player = game.getPlayer(req.cookies.username)
  const isHost = game.isHost(req.cookies.username)
  if (!player) {
    res.json({ mode: "restart" })
  } else if (player.species === "None") {
    res.json({
      mode: "chooseCharacter",
      playerSelectableSpecies: game.playerSelectableSpecies.map(p => ({ name: p.name, description: p.description })), //doesn't need to be loaded repeatedly, but oh well
      isHost
    })
  } else if (player.needsAnAbility()) {
    res.json({
      mode: "chooseAbility",
      newAbilities: game.getNewAbilityOptions(player),
      newAbilitiesNeeded: game.getNewAbilitiesNeeded(player),
      isHost
    })
  } else if (game.isInBattle()) {
    res.json({
      mode: "battle",
      enemies: game.getEnemies(),
      players: game.getPlayers(),
      log: game.logs.slice(-10), //Just the last 10 log entries for now
      isCurrentPlayerTurn: game.isPlayerBattleTurn(player),
      abilities: game.getBattleOptions(player),
	  imageFilename: game.getStory()?.imageFilename, //If the user refreshes, I still want the background to be there
      isHost
    })
  } else {
    res.json({
      mode: "story",
      story: game.getStory(),
      isHost
    })
  }
}))

app.post('/leave', catchErrors(async (req, res) => {
  const name = req.cookies.username
  if (name) {
    res.clearCookie('username')
    game.removeUser(name)
  }
  res.redirect('/')
}))

app.get('/players', catchErrors(async (req, res) => {
  res.json({ players: game.getUsers(), started: game.started })
}))

app.post('/start', catchErrors(async (req, res) => {
  if (game.isHost(req.cookies.username)) {
    game.start()
  }
  res.redirect('/')
}))

app.post('/stop', catchErrors(async (req, res) => {
  if (game.isHost(req.cookies.username)) {
    game = new Game() //Reset the game entirely, but keep the host around
    game.addUser(req.cookies.username)
  }
  res.redirect('/')
}))

app.listen(port, () => {
  console.log(`Game app listening on port ${port}`)
})