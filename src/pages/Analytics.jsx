import "../styles/analytics.css";


function Analytics(){

return(

<div className="analytics-page">


<div className="analytics-header">

<h1>
📊 Learning Analytics
</h1>

<p>
Track your learning performance and progress
</p>

</div>





<div className="analytics-stats">


<div className="analytics-card">

<h2>
85%
</h2>

<p>
Overall Progress
</p>

</div>



<div className="analytics-card">

<h2>
42
</h2>

<p>
Quizzes Completed
</p>

</div>




<div className="analytics-card">

<h2>
120 hrs
</h2>

<p>
Study Time
</p>

</div>



<div className="analytics-card">

<h2>
15 Days
</h2>

<p>
Study Streak
</p>

</div>


</div>






<div className="analytics-content">


<div className="chart-card">


<h2>
📈 Weekly Progress
</h2>


<div className="bars">


<div style={{height:"80%"}}>
Mon
</div>


<div style={{height:"60%"}}>
Tue
</div>


<div style={{height:"90%"}}>
Wed
</div>


<div style={{height:"70%"}}>
Thu
</div>


<div style={{height:"95%"}}>
Fri
</div>


</div>



</div>





<div className="performance-card">


<h2>
🎯 Performance
</h2>


<p>
AI Recommendation
</p>


<span>
Keep practicing quizzes and revise weak topics.
</span>


<button>
Improve Learning
</button>


</div>



</div>




</div>

)

}


export default Analytics;