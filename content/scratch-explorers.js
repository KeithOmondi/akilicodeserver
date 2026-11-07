/**
 * Block coding for ages 7 to 12: "Block Coding Adventures". More ideas than the little-coders module:
 * directions, loops, keys and choices, and variables. The last lesson points older children at the
 * "See the code" button, the bridge to typing JavaScript in the web editor.
 *
 *   node scripts/seed-course.js --branch --content scratch-explorers            (preview)
 *   node scripts/seed-course.js --branch --content scratch-explorers --apply    (write)
 */
module.exports = {
  courseTitle: 'Programming',
  module: {
    title: 'Block Coding Adventures',
    description: 'Programming with blocks: directions, loops, keys and choices, and a score. Build a small game.',
    ageGroups: ['7-9', '10-12'],
    lessonType: 'scratch',
  },
  lessons: [
    {
      title: 'Move, Turn and Say',
      notes: `# Move, turn and say 🧭

Every program starts with **one block you can trust**. Under the yellow **when 🏁 clicked** block, the cat does each block **in order**, from the top to the bottom.

## Directions

The cat has a **direction**, like a compass. **90** points **right**, **0** points **up**, **180** points **down** and **270** points **left**.

A full circle is **360 degrees**. So **turn 90 degrees** is a quarter turn, like turning a corner.

## Places on the stage

The stage has an **x** (across) and a **y** (up and down). The middle is **x: 0, y: 0**. The block **go to x: y:** sends the cat straight to a place.

> Try **go to x: 200 y: 100**. Where does the cat land? Try a negative number like **-200**.

## Your assignment ✏️

Make the cat **walk around a square**: **move 100 steps**, **turn 90 degrees**, and do it **four times** (with four sets of blocks, or a repeat block if you already know it). Add a **say** block at the start. Press **Start**, then **Hand in**.

## Go further (ages 10 and up)

Press **See the code** under the stage. You will see your blocks written as **JavaScript**. This is what real programmers type! Spot the numbers you chose.`,
      assignment: 'Make the cat walk around a square: move 100 steps and turn 90 degrees, four times. Add a say block at the start. Press Start to check it, then hand it in.',
      questions: [
        { question: 'Which direction does 90 point to?', options: ['Right', 'Up', 'Left'], answer: 0 },
        { question: 'How many degrees make a full turn?', options: ['90', '180', '360'], answer: 2 },
      ],
    },
    {
      title: 'Loops: Repeat and Forever',
      notes: `# Loops: repeat and forever 🔁

You could use **four** sets of blocks to draw a square. But a **loop** does it with **one** set. A loop **repeats** the blocks inside it.

## Two kinds of loops

**repeat 4** runs the blocks inside **four times**, then stops. A square is **repeat 4** with **move 100** and **turn 90** inside.

**forever** runs the blocks inside **again and again** until you press **Stop**.

## The bounce trick

Put **move 10 steps** and **if on edge, bounce** inside a **forever** block. The cat walks to the edge of the stage and bounces back, **for ever**!

> A loop runs **one round per frame** so you can watch it. That is why the cat moves smoothly.

## Your assignment ✏️

Make the cat **bounce around the stage forever**. Use **forever**, **move 10 steps** and **if on edge, bounce**. Then add a **turn** block inside to make it spin as it moves. Press **Start**, then **Hand in**.`,
      assignment: 'Make the cat bounce around the stage forever. Use a forever block with move 10 steps and "if on edge, bounce" inside. Add a turn block to make it spin as it moves. Press Start to check it, then hand it in.',
      questions: [
        { question: 'What does a forever block do?', options: ['Runs once and stops', 'Repeats its blocks until you press Stop', 'Deletes the other blocks'], answer: 1 },
        { question: 'To walk around a square with a loop, how many degrees does each turn need?', options: ['45', '90', '360'], answer: 1 },
      ],
    },
    {
      title: 'Keys and Choices',
      notes: `# Keys and choices ⌨️

So far the program ran by itself. Now **you** decide what happens, using the keyboard!

## Keys

The yellow block **when space key pressed** waits for you. You can pick another key, such as **up arrow** or **w**. When you press it, the blocks under it run.

Put **change y by 10** under **when up arrow pressed** and **change y by -10** under **when down arrow pressed**. Now the arrow keys move the cat up and down!

## Choices

Sometimes the program must **decide**. The orange **if** block runs its blocks **only when something is true**.

Example: **if touching edge? then say Ouch!**

> Click on the stage first, so it can hear your keyboard.

## Your assignment ✏️

Make the cat move with the **four arrow keys** (use **change x** and **change y**). Add an **if** block that makes the cat **say Ouch!** when it is **touching edge?**. Press **Start**, then **Hand in**.`,
      assignment: 'Make the cat move with the four arrow keys (use change x and change y blocks). Add an "if touching edge" block that makes the cat say "Ouch!". Press Start, click the stage, try it, then hand it in.',
      questions: [
        { question: 'Which block lets the keyboard control your cat?', options: ['wait 1 seconds', 'when up arrow key pressed', 'stop all'], answer: 1 },
        { question: 'An if block runs its blocks...', options: ['always', 'only when its condition is true', 'never'], answer: 1 },
      ],
    },
    {
      title: 'Variables and a Score',
      notes: `# Variables and a score 🏆

A **variable** is a **box with a name** that holds a number or some words. A game uses one to count the **score**.

## Make a variable

Open **Variables** (the dark orange one) and press **Create variable**. Call it **score**.

You get blocks to **set score to 0** and **change score by 1**, and one that **shows** the score. Put the score block inside **say** to show it!

## A little game

**1.** Under **when 🏁 clicked**, put **set score to 0**.

**2.** Add **when this sprite clicked**. Under it put **change score by 1**, **say score**, and **go to x: (random integer from -200 to 200) y: (random integer from -150 to 150)**.

**3.** Press **Start** and click the cat. It **jumps** and your score goes **up**! 🎮

## Go further (ages 10 and up)

Press **See the code**. The variable becomes a line like score = score + 1. In JavaScript you type exactly that. Next you will build web pages with the same ideas.

## Your assignment ✏️

Make the **catch the cat** game: a **score** variable, a cat that **jumps to a random place** when you click it, and the score shown with **say**. Press **Start**, play, then **Hand in**.`,
      assignment: 'Make the "catch the cat" game: a score variable that goes up by 1 each time you click the cat, and the cat jumps to a random place and says the score. Press Start, play it, then hand it in.',
      questions: [
        { question: 'A variable is...', options: ['A box with a name that holds a value', 'A kind of costume', 'A sound'], answer: 0 },
        { question: 'Which block picks a different place for the cat each time?', options: ['wait', 'random integer from … to …', 'show'], answer: 1 },
      ],
    },
  ],
};
