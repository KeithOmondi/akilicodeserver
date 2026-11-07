/**
 * Block coding for the youngest group (ages 4 to 6): "Little Coders: Move the Cat".
 * Very short sentences, one idea per lesson, colours and pictures instead of terms.
 * Every assignment is made in the block editor (lesson type "scratch") and handed in.
 *
 *   node scripts/seed-course.js --branch --content scratch-tots            (preview)
 *   node scripts/seed-course.js --branch --content scratch-tots --apply    (write)
 */
module.exports = {
  courseTitle: 'Programming',
  module: {
    title: 'Little Coders: Move the Cat',
    description: 'Snap colourful blocks together and make a cat move, talk and dance. No typing and no reading skills needed beyond a few words.',
    ageGroups: ['4-6'],
    lessonType: 'scratch',
  },
  lessons: [
    {
      title: 'Meet the Cat',
      notes: `# Meet the cat 🐱

This cat is **your cat**. You are the boss! You tell the cat what to do with **blocks**.

## How it works

Blocks are like **LEGO** 🧱. You snap them together. The cat does the blocks from the top, one by one.

**1.** Open the **Make** page and press **New blocks project**.

**2.** Find the **yellow** block that says **when 🏁 clicked**. It is already there!

**3.** Click **Motion** (the **blue** one). Drag **move 10 steps** under the yellow block.

**4.** Press the green **Start** button. The cat walks! 🎉

> Make the number bigger. What happens to the cat?

## Your assignment ✏️

Make your cat **walk**. Use the blue **move** block under the yellow block. Press **Start**, then **Hand in**.`,
      assignment: 'Make your cat walk. Put a blue move block under the yellow "when flag clicked" block. Press Start to see it. Then hand it in.',
      questions: [
        { question: 'Which button makes your cat start?', options: ['The green Start button', 'The Stop button', 'The trash can'], answer: 0 },
        { question: 'Which colour are the blocks that make the cat WALK?', options: ['Red', 'Purple', 'Blue'], answer: 2 },
      ],
    },
    {
      title: 'Make the Cat Talk',
      notes: `# Make the cat talk 💬

Your cat can talk! The blocks for talking are **purple** 💜. They are called **Looks**.

## How to do it

**1.** Click **Looks** (the purple one).

**2.** Drag **say Hello! for 2 seconds** under the yellow block.

**3.** Click on the word **Hello!** and type something new. Try your **name**!

**4.** Press **Start**. The cat says your words. 🗣️

> You can put a **move** block under it too. The cat talks, then walks!

## Your assignment ✏️

Make the cat **say your name** and then **walk**. Press **Start** to check, then **Hand in**.`,
      assignment: 'Make the cat say your name (use a purple say block) and then walk (a blue move block). Press Start to check it, then hand it in.',
      questions: [
        { question: 'What colour are the blocks that make the cat TALK?', options: ['Orange', 'Purple', 'Green'], answer: 1 },
        { question: 'What does the "say Hello!" block do?', options: ['The cat goes to sleep', 'The cat talks', 'The cat gets small'], answer: 1 },
      ],
    },
    {
      title: 'Make the Cat Dance',
      notes: `# Make the cat dance 💃

Do you want the cat to do a thing **again and again**? There is a block for that!

It is called **repeat**. It is **orange** 🧡 and it is in **Control**.

## How to do it

**1.** Drag **repeat 10** under the yellow block.

**2.** Put a blue **move 10 steps** block **inside** the repeat. It looks like a mouth that eats blocks! 😋

**3.** Put a blue **turn** block in there too.

**4.** Press **Start**. The cat spins and moves again and again! 🌀

> Change the **10** to **20**. What happens?

## Your assignment ✏️

Make a **dancing cat**. Use **repeat** with a **move** and a **turn** inside. Press **Start**, then **Hand in**.`,
      assignment: 'Make a dancing cat. Use an orange repeat block with a blue move block and a blue turn block inside it. Press Start to check it, then hand it in.',
      questions: [
        { question: 'What does the repeat block do?', options: ['It makes things happen again and again', 'It makes the cat disappear', 'It switches the lights off'], answer: 0 },
        { question: 'Which block turns the cat around?', options: ['say Hello', 'wait 1 second', 'turn 15 degrees'], answer: 2 },
      ],
    },
  ],
};
