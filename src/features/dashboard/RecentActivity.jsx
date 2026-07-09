const activities=[

"Completed AI Quiz",

"Uploaded DBMS Notes",

"Generated Flashcards",

"Studied Python for 2 Hours"

];

const RecentActivity=()=>{

return(

<div className="widget">

<h3>Recent Activity</h3>

<ul className="activity-list">

{

activities.map((item,index)=>(

<li key={index}>{item}</li>

))

}

</ul>

</div>

);

};

export default RecentActivity;