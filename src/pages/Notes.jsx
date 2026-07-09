import "../styles/notes.css";


function Notes(){

const notes = [
    {
        title:"Machine Learning",
        subject:"AI",
        date:"Today"
    },
    {
        title:"Internet of Things",
        subject:"IoT",
        date:"Yesterday"
    },
    {
        title:"Database Management",
        subject:"DBMS",
        date:"2 days ago"
    }
];


return(

<div className="notes-page">


<div className="notes-header">

<h1>
📝 My Notes
</h1>

<p>
Manage your AI generated and uploaded study notes
</p>

</div>



<div className="notes-tools">

<input 
placeholder="🔍 Search notes..."
/>


<button>
+ Create Notes
</button>


</div>




<div className="notes-grid">


{
notes.map((note,index)=>(

<div 
className="note-card"
key={index}
>


<div className="note-icon">
📚
</div>


<h2>
{note.title}
</h2>


<span>
{note.subject}
</span>


<p>
Created {note.date}
</p>



<div className="note-actions">

<button>
View
</button>


<button>
Delete
</button>


</div>


</div>

))
}



</div>


</div>

)

}


export default Notes;