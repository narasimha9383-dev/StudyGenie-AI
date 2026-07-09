import "../styles/quiz.css";


function Quiz(){

return(

<div className="quiz-page">


<div className="quiz-header">

<h1>
🎯 AI Quiz Generator
</h1>

<p>
Test your knowledge with AI generated quizzes
</p>

</div>




<div className="quiz-generator">


<div className="quiz-option">


<h2>
📚 Select Topic
</h2>


<input 
placeholder="Enter topic (Example: Machine Learning)"
/>


</div>





<div className="quiz-option">


<h2>
⚡ Difficulty Level
</h2>


<div className="difficulty">


<button>
Easy
</button>


<button>
Medium
</button>


<button>
Hard
</button>


</div>


</div>





<button className="generate-btn">

✨ Generate Quiz

</button>


</div>






<div className="question-card">


<div className="question-number">

Question 1 / 10

</div>


<h2>

What is Machine Learning?

</h2>



<div className="options">


<button>
A. Programming language
</button>


<button>
B. Learning from data
</button>


<button>
C. Database system
</button>


<button>
D. Operating system
</button>


</div>



</div>





<div className="quiz-result">


<h2>
🏆 Quiz Progress
</h2>


<p>
Completed: 5 / 10 Questions
</p>



<div className="quiz-progress">

<div></div>

</div>


</div>



</div>

)

}


export default Quiz;