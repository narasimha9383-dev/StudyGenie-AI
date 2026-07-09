import {
FileUp,
ClipboardList,
BrainCircuit,
Layers
} from "lucide-react";

const actions=[

{
icon:<FileUp/>,
title:"Upload PDF"
},

{
icon:<ClipboardList/>,
title:"Generate Quiz"
},

{
icon:<Layers/>,
title:"Flashcards"
},

{
icon:<BrainCircuit/>,
title:"AI Tutor"
}

];

const QuickActions=()=>{

return(

<div className="widget">

<h3>Quick Actions</h3>

<div className="quick-grid">

{

actions.map((item,index)=>(

<button

className="quick-btn"

key={index}

>

{item.icon}

<p>{item.title}</p>

</button>

))

}

</div>

</div>

);

};

export default QuickActions;