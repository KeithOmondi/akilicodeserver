/**
 * Starter content for the course called "Programming": one module, five short lessons for ALL ages (4 to 18),
 * ten quiz questions (two per lesson) and one offline assignment per lesson.
 *
 * Writing rules (the lesson page shows notes with a very small Markdown renderer):
 *  - plain, short sentences; no jargon without an example
 *  - each lesson has a main part for everyone and a "Go further" part for older learners
 *  - at most ONE bullet list per lesson, no tables, no links
 *  - a child finishes a lesson by passing its quiz (70%), so every lesson has exactly two questions
 *
 * Edit freely, then run:  node scripts/seed-course.js --branch            (preview)
 *                         node scripts/seed-course.js --branch --apply    (write)
 */
module.exports = {
  courseTitle: 'Programming',
  module: {
    title: 'Programming for Everyone',
    description: 'What programming is, and the four big ideas behind every program: instructions, order, repeating and choosing.',
  },
  lessons: [
    {
      title: 'What is Programming?',
      notes: `# What is programming? 🤖

A computer is very fast, but it is **not clever on its own**. It cannot guess what you want. It only does what it is told, step by step.

The instructions we give a computer are called a **program**. The person who writes them is a **programmer**. You can be one too!

## Programs are everywhere

Programs make the games you play, the videos you watch and the M-Pesa on your phone. Even a microwave and a traffic light follow a small program.

> Think about it: when you press a button on a microwave, it does exactly what it was told. It never decides to do something else.

## Your challenge ✏️

Find **3 things** at home that have a computer inside, for example a phone, a TV or a microwave. Tell someone how you think each one follows instructions.

## Go further (ages 10 and up)

Programs are written in special languages such as Python, JavaScript and Scratch. They are not like English, because a computer needs every word to be exact.`,
      assignment: 'Find 3 things at home that have a computer inside (for example a phone, a TV or a microwave). Draw or write them down, and tell someone at home how you think each one follows instructions.',
      questions: [
        { question: 'A computer is good at...', options: ['Guessing what you want', 'Following instructions exactly', 'Reading your mind', 'Making up its own rules'], answer: 1 },
        { question: 'A set of instructions that tells a computer what to do is called a...', options: ['Program', 'Picture', 'Battery', 'Password'], answer: 0 },
      ],
    },
    {
      title: 'Instructions in the Right Order',
      notes: `# Instructions in the right order 📋

A computer follows instructions **one after the other, in order**. A list of steps that solves a problem is called an **algorithm**. That is a big word for a simple idea: a recipe.

## Try it with chai ☕

To make chai you must boil the water first, then add the tea, then pour it into a cup. If you pour first and boil last, you get a mess!

> The order of the steps matters. The computer cannot guess that you meant a different order.

## Your challenge ✏️

Write the steps for making a cup of chai or a sandwich, as if you are talking to a robot. Then ask a grown-up to follow your steps **exactly**, and nothing more. Did anything go wrong? Fix that step.

## Go further (ages 10 and up)

In Python, the computer reads the lines from top to bottom:

\`print("Wake up")\`
\`print("Brush teeth")\`
\`print("Go to school")\`

Swap two lines and the story changes.`,
      assignment: 'Write the steps for making a cup of chai or a sandwich, as if you are telling a robot. Ask a grown-up to follow your steps exactly, and fix any step that went wrong.',
      questions: [
        { question: 'Why does the order of the steps matter?', options: ['It does not matter', 'Computers like long lists', 'Order only matters in games', 'The wrong order can give the wrong result'], answer: 3 },
        { question: 'To make a cup of tea, which step comes FIRST?', options: ['Drink the tea', 'Pour the tea into the cup', 'Boil the water', 'Wash the cup afterwards'], answer: 2 },
      ],
    },
    {
      title: 'Do It Again: Loops',
      notes: `# Do it again: loops 🔁

Imagine you must clap 5 times. You could write "clap, clap, clap, clap, clap". Or you could write one short line:

**Repeat 5 times: clap**

That is a **loop**. A loop tells the computer to do something again and again, so we do not have to write it many times.

## Why loops are great

Loops make programs shorter, and they stop us from making mistakes by copying the same line again and again.

## Your challenge ✏️

Make up a dance with **3 moves** and repeat it **4 times**. Write it like this: repeat 4 times: move 1, move 2, move 3. Then do the dance!

## Go further (ages 10 and up)

In Python a loop looks like this:

\`for i in range(5): print("Hello")\`

It prints Hello five times. Try changing the 5 to a bigger number.`,
      assignment: 'Make up a dance with 3 moves and repeat it 4 times. Write it as: repeat 4 times: move 1, move 2, move 3. Then do the dance! Older learners: write it in Python with a for loop.',
      questions: [
        { question: 'A loop is used to...', options: ['Stop the program', 'Repeat steps again and again', 'Delete the program', 'Change the colour'], answer: 1 },
        { question: 'Instead of writing "clap" 5 times, we write "repeat 5 times: clap". Why is this useful?', options: ['It makes programs shorter and easier to read', 'It makes the computer slower', 'It adds sound', 'It breaks the program'], answer: 0 },
      ],
    },
    {
      title: 'Making Choices: If and Else',
      notes: `# Making choices: if and else 🌦️

We make choices all day. **If** it is raining, we take an umbrella. **Else** (if it is not raining), we leave the umbrella at home.

Programs make choices in just the same way. The part after **if** is the **condition**. It is either true or false. In our example the condition is "it is raining".

> If the condition is true, the computer does the first thing. Else, it does the other thing.

## Your challenge ✏️

Write **3 if and else rules** for your own day. For example: if it is Saturday, I play football, else I go to school. Ask a family member for one more rule to add.

## Go further (ages 10 and up)

In Python:

\`if raining: print("Take an umbrella")\`

You can add \`else:\` on the next line for the other choice. Games use choices all the time, for example: if the player touches a coin, add 1 to the score.`,
      assignment: 'Write 3 "if / else" rules for your own day (for example: if it is Saturday, play football, else go to school). Ask a family member for one more rule idea.',
      questions: [
        { question: 'In "If it is raining, take an umbrella", what is the condition?', options: ['Take an umbrella', 'Go outside', 'It is raining', 'The umbrella is red'], answer: 2 },
        { question: 'What does "else" mean in a program?', options: ['What to do when the "if" is not true', 'The end of the program', 'A kind of loop', 'A bug'], answer: 0 },
      ],
    },
    {
      title: 'Finding and Fixing Bugs',
      notes: `# Finding and fixing bugs 🐞

Every programmer makes mistakes, even the best ones. A mistake in a program is called a **bug**. Finding and fixing it is called **debugging**.

Bugs are not a sign that you are bad at this. They are a normal part of programming, and fixing them is how you learn.

## How to catch a bug

Read your steps slowly. Test **one step at a time**. Ask yourself: what did I expect, and what really happened? Then change one thing and try again. Do not give up!

## Your challenge ✏️

Take your chai or sandwich steps from Lesson 2 and swap with a friend or a brother or sister. Try to find **one bug** in their steps, and kindly help them fix it. Then write one thing you learned.

## Go further (ages 10 and up)

Real programmers read the error message the computer gives them, because it often says what line the bug is on. Printing a value in the middle of a program is another good way to see what is happening.`,
      assignment: 'Swap your chai or sandwich steps from Lesson 2 with a friend or a brother or sister. Find one bug in theirs and kindly help them fix it. Write one thing you learned.',
      questions: [
        { question: 'A bug in a program is...', options: ['A real insect inside the computer', 'A new feature', 'A mistake that stops the program working as planned', 'A kind of game'], answer: 2 },
        { question: 'What is a good first step when your program does not work?', options: ['Throw away the computer', 'Give up', 'Delete everything', 'Read it slowly and test one step at a time'], answer: 3 },
      ],
    },
  ],
};
