import "../styles/flashcards.css";


function Flashcards(){

const cards = [

{
title:"Machine Learning",
question:"What is supervised learning?",
answer:"Learning from labeled data"
},

{
title:"IoT",
question:"What is IoT?",
answer:"Internet connected smart devices"
},

{
title:"Database",
question:"What is SQL?",
answer:"Language used to manage databases"
}

];


return(

<div className="flashcards-page">


<div className="flash-header">

<h1>
🗂 AI Flashcards
</h1>

<p>
Create and revise concepts quickly with smart flashcards
</p>

</div>





<div className="flash-actions">

<button>
✨ Generate Flashcards
</button>

<button>
+ Create Deck
</button>

</div>





<div className="flash-grid">


{
cards.map((card,index)=>(


<div className="flash-card" key={index}>


<div className="flash-top">

📚 {card.title}

</div>


<h2>
{card.question}
</h2>


<p>
{card.answer}
</p>



<button>
Flip Card
</button>


</div>


))
}


</div>





</div>

)

}


export default Flashcards;