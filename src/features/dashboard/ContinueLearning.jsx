const ContinueLearning = () => {

  const courses = [

    {
      subject:"Machine Learning",
      progress:"80%"
    },

    {
      subject:"Python",
      progress:"62%"
    },

    {
      subject:"DBMS",
      progress:"40%"
    }

  ];

  return(

<div className="widget">

<h3>Continue Learning</h3>

{

courses.map((course,index)=>(

<div className="course-item" key={index}>

<div>

<h4>{course.subject}</h4>

<p>{course.progress} Completed</p>

</div>

<button>Resume</button>

</div>

))

}

</div>

);

};

export default ContinueLearning;