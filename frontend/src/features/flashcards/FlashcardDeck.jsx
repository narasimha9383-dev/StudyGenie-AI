import Flashcard from "./Flashcard";

function FlashcardDeck() {
  const cards = [
    {
      question: "What is React state?",
      answer: "State is data that changes over time in a component.",
    },
    {
      question: "What is a hook?",
      answer:
        "A hook is a special function that lets components use React features.",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cards.map((card) => (
        <Flashcard
          key={card.question}
          question={card.question}
          answer={card.answer}
        />
      ))}
    </div>
  );
}

export default FlashcardDeck;
