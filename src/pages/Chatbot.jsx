import "../styles/chatbot.css";


function Chatbot(){

return(

<div className="chatbot-page">


<div className="chat-header">

<h1>
🤖 AI Tutor
</h1>

<p>
Ask anything and learn with your personal AI assistant
</p>

</div>





<div className="chat-container">


<div className="chat-messages">


<div className="ai-message">

🤖 Hello! I am your AI Tutor. How can I help you today?

</div>



<div className="user-message">

Explain Machine Learning

</div>



<div className="ai-message">

Machine Learning is a branch of AI that allows computers to learn from data.

</div>



</div>






<div className="suggestions">


<button>
Explain this topic
</button>


<button>
Create Notes
</button>


<button>
Generate Quiz
</button>


<button>
Give Examples
</button>


</div>






<div className="chat-input">


<input
placeholder="Ask your question..."
/>


<button>
Send
</button>


</div>



</div>



</div>

)

}


export default Chatbot;