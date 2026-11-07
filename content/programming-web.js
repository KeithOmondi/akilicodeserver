/**
 * Second module for the course "Programming": build a real web page with HTML, CSS and JavaScript in the
 * editor. Every assignment here is made in the editor and handed in for the teacher.
 *
 * Notes are shown through a tiny Markdown renderer that passes HTML through, so tags are written as
 * entities (&lt;h1&gt;) to be SHOWN rather than obeyed.
 *
 *   node scripts/seed-course.js --branch --content programming-web            (preview)
 *   node scripts/seed-course.js --branch --content programming-web --apply    (write)
 */
module.exports = {
  courseTitle: 'Programming',
  module: {
    title: 'Build Your First Web Page',
    description: 'Make a real web page in the editor with HTML, CSS and JavaScript, and hand it in.',
  },
  lessons: [
    {
      title: 'HTML: What Is On Your Page',
      notes: `# HTML: what is on your page 🧱

Every web page you have ever seen is built with **HTML**. HTML tells the computer **what is on the page**: headings, words, buttons and more.

HTML uses **tags**. A tag is a word inside angle brackets. Most tags come in a pair: one to start and one to finish.

## Tags you will use today

\`&lt;h1&gt;My name&lt;/h1&gt;\` makes the biggest heading.

\`&lt;p&gt;I like football.&lt;/p&gt;\` makes a paragraph of words.

\`&lt;button&gt;Click me&lt;/button&gt;\` makes a button.

> Open the **Make** editor on the HTML tab, change the words between the tags, and press **Run**. Your page changes straight away!

## Your assignment ✏️

Build a page about **you**. It must have a big heading with your name, a short paragraph about what you like, and a button. Use the editor, press Run to check it, then **Hand in**.

## Go further (ages 10 and up)

Try \`&lt;h2&gt;\` for a smaller heading, and put an emoji like 😀 in your text. Pictures from the internet cannot load in the editor for your safety, but emoji work everywhere.`,
      assignment: 'Open the editor and build a page about you. It must have a big heading with your name, a short paragraph about what you like, and a button. Press Run to check it, then hand it in.',
      questions: [
        { question: 'What does HTML do?', options: ['It decides what is on the page, like headings, words and buttons', 'It stores your files in the cloud', 'It makes the computer faster', 'It is a type of mouse'], answer: 0 },
        { question: 'Which tag makes the biggest heading?', options: ['<p>', '<h1>', '<button>', '<small>'], answer: 1 },
      ],
    },
    {
      title: 'CSS: Make It Look Good',
      notes: `# CSS: make it look good 🎨

HTML puts things on the page. **CSS** decides **how they look**: colours, sizes and where things go.

A CSS rule has three parts:

\`h1 { color: purple; }\`

The **h1** says WHAT to change. The **color** says WHICH thing to change. The **purple** says what to change it TO.

## Things to try

Change the background with \`body { background: lightyellow; }\`.

Make words bigger with \`p { font-size: 24px; }\`.

Round a button with \`button { border-radius: 12px; }\`.

> Colours have names such as red, blue, orange and pink. Older learners can also use codes like #7c3aed.

## Your assignment ✏️

In the editor, put the HTML from your first page on the HTML tab (copy it from your last project). Then use the CSS tab to: give the page a **background colour**, change the **heading colour**, and make the **words bigger**. Press Run, then **Hand in**.

## Go further (ages 10 and up)

Try \`text-align: center;\` on the body to put everything in the middle, and \`padding: 20px;\` to give your button some space.`,
      assignment: 'Put your HTML from the first page into the editor. Use the CSS tab to give the page a background colour, change the heading colour and make the words bigger. Press Run, then hand it in.',
      questions: [
        { question: 'What does CSS do?', options: ['It runs the internet', 'It changes how things look, like colours and sizes', 'It adds keys to the keyboard', 'It deletes mistakes'], answer: 1 },
        { question: 'In "h1 { color: red; }" which part tells the computer WHAT to change?', options: ['red', 'color', 'h1', '{ }'], answer: 2 },
      ],
    },
    {
      title: 'JavaScript: Make It Do Things',
      notes: `# JavaScript: make it do things ⚡

HTML is what is on the page. CSS is how it looks. **JavaScript** is what the page **does**: it reacts when you click, type or press a key.

## Your first JavaScript

\`alert("Hello!");\` shows a message box.

\`console.log("hi");\` writes a message in the Messages box under your page. Programmers use this to see what their code is doing.

## Reacting to a click

Give your button an id, like \`&lt;button id="btn"&gt;\`. Then, in JavaScript, tell the computer what to do when it is clicked:

\`document.getElementById("btn").addEventListener("click", () => { alert("You clicked me!"); });\`

Read it slowly: find the button called btn, listen for a click, and when it happens, show a message.

> The editor starts you off with exactly this. Change the message and press Run.

## Your assignment ✏️

Make a page with a button. When you click it, the page must **change**: for example the words change, or the colour changes. Then add **one more thing you invent yourself**. Press Run to test, then **Hand in**.

## Go further (ages 10 and up)

To change some words, give an element an id and set its text: \`document.getElementById("msg").textContent = "New words!";\`. To change a colour: \`document.body.style.background = "pink";\`.`,
      assignment: 'Make a page with a button. When you click it, the page must change (for example the words or the colour). Then add one more thing you invent yourself. Press Run to test it, then hand it in.',
      questions: [
        { question: 'What does JavaScript do?', options: ['It makes your page do things, like reacting to a click', 'It prints the page on paper', 'It changes the shape of your keyboard', 'It only makes colours'], answer: 0 },
        { question: 'A button is on the page. Which language makes something HAPPEN when it is clicked?', options: ['Only CSS', 'JavaScript', 'Nothing can', 'Only HTML'], answer: 1 },
      ],
    },
  ],
};
