import "../styles/planner.css";


function Planner(){

const tasks = [

{
title:"Complete Machine Learning Notes",
time:"10:00 AM",
status:"Completed"
},

{
title:"Generate AI Quiz",
time:"2:00 PM",
status:"Pending"
},

{
title:"Revise IoT Concepts",
time:"6:00 PM",
status:"Upcoming"
}

];


return(

<div className="planner-page">


<div className="planner-header">

<h1>
📅 Study Planner
</h1>

<p>
Plan your daily learning activities and stay productive
</p>

</div>





<div className="planner-top">


<div className="calendar-card">

<h2>
🗓 Today
</h2>

<div className="calendar">

01 02 03 04 05

<br/>

06 07 08 09 10

<br/>

11 12 13 14 15

</div>


</div>





<div className="goal-card">

<h2>
🎯 Daily Goal
</h2>


<h1>
75%
</h1>


<p>
Keep going! Complete your target.
</p>


</div>


</div>







<div className="task-section">


<h2>
📚 Today's Tasks
</h2>



<div className="task-grid">


{
tasks.map((task,index)=>(

<div className="task-card" key={index}>


<h3>
{task.title}
</h3>


<p>
🕒 {task.time}
</p>


<span>
{task.status}
</span>


</div>

))
}



</div>


</div>




</div>

)

}


export default Planner;