import "../styles/notifications.css";


function Notifications(){

const notifications=[

{
icon:"🎯",
title:"Quiz Completed",
text:"You completed Machine Learning Quiz",
time:"10 minutes ago"
},

{
icon:"📄",
title:"PDF Uploaded",
text:"Your AI notes are ready",
time:"1 hour ago"
},

{
icon:"🔥",
title:"Study Streak",
text:"You reached 15 days streak",
time:"Today"
},

{
icon:"🤖",
title:"AI Recommendation",
text:"Revise important topics",
time:"Today"
}

];


return(

<div className="notifications-page">


<div className="notification-header">

<h1>
🔔 Notifications
</h1>

<p>
Stay updated with your learning activities
</p>

</div>





<div className="notification-container">


{
notifications.map((item,index)=>(


<div className="notification-card" key={index}>


<div className="notification-icon">

{item.icon}

</div>


<div className="notification-content">


<h2>
{item.title}
</h2>


<p>
{item.text}
</p>


<span>
{item.time}
</span>


</div>



<button>
View
</button>



</div>


))
}



</div>




</div>

)

}


export default Notifications;