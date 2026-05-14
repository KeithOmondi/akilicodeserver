# 🧮 Math Challenge Game!
import random

print("=" * 40)
print("     MATH CHALLENGE CALCULATOR")
print("=" * 40)
print()

score = 0

for round_num in range(1, 6):
    print(f"Round {round_num}/5")
    
    num1 = random.randint(1, 50)
    num2 = random.randint(1, 50)
    operation = random.choice(['+', '-', '*'])
    
    if operation == '+':
        answer = num1 + num2
        question = f"{num1} + {num2}"
    elif operation == '-':
        answer = num1 - num2
        question = f"{num1} - {num2}"
    else:
        answer = num1 * num2
        question = f"{num1} * {num2}"
    
    try:
        user_answer = int(input(f"What is {question}? "))
        
        if user_answer == answer:
            print("  ✅ Correct! +10 points")
            score += 10
        else:
            print(f"  ❌ Wrong! The answer is {answer}")
    except ValueError:
        print("  ❌ Please enter a number!")
    
    print()

print("=" * 40)
print(f"  FINAL SCORE: {score}/50")
if score >= 40:
    print("  🌟 EXCELLENT! Math wizard!")
elif score >= 25:
    print("  👍 Good job! Keep practicing!")
else:
    print("  💪 Keep trying! Math gets easier with practice!")
print("=" * 40)