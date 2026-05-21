# 🎮 Number Guessing Game!
import random

print("=" * 40)
print("   WELCOME TO NUMBER GUESSING GAME!")
print("=" * 40)
print()

secret_number = random.randint(1, 100)
attempts = 0

print("I'm thinking of a number between 1 and 100...")
print()

while True:
    try:
        guess = int(input("Your guess: "))
        attempts += 1
        
        if guess < secret_number:
            print(f"  📈 {guess} is too low! Try a higher number.")
        elif guess > secret_number:
            print(f"  📉 {guess} is too high! Try a lower number.")
        else:
            print()
            print("=" * 40)
            print(f"  🎉 CONGRATULATIONS! 🎉")
            print(f"  You guessed {secret_number} in {attempts} attempts!")
            print("=" * 40)
            break
            
        print()
        
    except ValueError:
        print("  ❌ Please enter a valid number!")
        print()

print("\nThanks for playing! 🎮")