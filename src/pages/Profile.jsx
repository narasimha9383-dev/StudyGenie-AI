import "../styles/profile.css";


function Profile(){

return(

<div className="profile-page">


<div className="profile-header">

<h1>
👤 My Profile
</h1>

<p>
Manage your account and learning achievements
</p>

</div>





<div className="profile-container">



<div className="profile-card">


<div className="profile-avatar">

👨‍🎓

</div>


<h2>
Student
</h2>


<p>
AI Learner
</p>



<button>
Edit Profile
</button>


</div>






<div className="profile-details">


<div className="detail-card">

<h3>
📚 Courses Completed
</h3>

<h2>
12
</h2>

</div>





<div className="detail-card">

<h3>
🔥 Study Streak
</h3>

<h2>
15 Days
</h2>

</div>





<div className="detail-card">

<h3>
🏆 Achievements
</h3>

<h2>
8 Badges
</h2>

</div>



</div>




</div>





<div className="achievement-section">


<h2>
🎖 Recent Achievements
</h2>



<div className="achievement-grid">


<div>
🚀
<p>
AI Master
</p>
</div>



<div>
📚
<p>
Note Creator
</p>
</div>



<div>
🔥
<p>
7 Day Streak
</p>
</div>



</div>


</div>




</div>

)

}


export default Profile;