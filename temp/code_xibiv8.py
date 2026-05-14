# 📝 Fun Quiz Game!
print("=" * 40)
print("     WELCOME TO THE QUIZ GAME!")
print("=" * 40)
print()

score = 0
questions = [
    ("What is the capital of France?", "Paris"),
    ("What is 5 + 7?", "12"),
    ("What color is the sky on a clear day?", "Blue"),
    ("Who painted the Mona Lisa?", "Da Vinci"),
]

for i, (question, answer) in enumerate(questions, 1):
    print(f"Question {i}: {question}")
    user_answer = input("Your answer: ")
    
    if user_answer.lower() == answer.lower():
        print("  ✅ Correct! +1 point")
        score += 1
    else:
        print(f"  ❌ Wrong! The answer is {answer}")
    print()

print("=" * 40)
print(f"  Your final score: {score}/{len(questions)}")
if score == len(questions):
    print("  🎉 PERFECT SCORE! You're a genius!")
elif score >= len(questions) // 2:
    print("  👍 Good job! Keep learning!")
else:
    print("  📚 Keep practicing! You'll do better next time!")
print("=" * 40)