import "../styles/leaderboard.css";


function Leaderboard(){

const users = [

{
rank:1,
name:"Alex",
points:"9800",
badge:"🥇"
},

{
rank:2,
name:"Student",
points:"9200",
badge:"🥈"
},

{
rank:3,
name:"John",
points:"8500",
badge:"🥉"
},

{
rank:4,
name:"Emma",
points:"7900",
badge:"⭐"
}

];


return(

<div className="leaderboard-page">


<div className="leader-header">

<h1>
🏆 Leaderboard
</h1>

<p>
Track your learning achievements and compete with others
</p>

</div>





<div className="rank-card">

<h2>
Your Rank
</h2>

<div className="rank-number">

#12

</div>


<p>
Keep learning to reach the top!
</p>


</div>






<div className="leader-list">


{
users.map((user,index)=>(

<div className="leader-item" key={index}>


<div className="rank">

{user.badge}

</div>


<div className="user-info">

<h3>
{user.name}
</h3>

<p>
{user.points} Points
</p>

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


export default Leaderboard;