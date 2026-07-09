import "../styles/settings.css";


function Settings(){

return(

<div className="settings-page">


<div className="settings-header">

<h1>
⚙️ Settings
</h1>

<p>
Manage your account preferences and application settings
</p>

</div>





<div className="settings-container">



<div className="settings-card">

<h2>
👤 Account Settings
</h2>


<div className="setting-item">

<span>
Name
</span>

<input 
value="Student"
readOnly
/>

</div>



<div className="setting-item">

<span>
Email
</span>

<input 
value="student@gmail.com"
readOnly
/>

</div>


<button>
Save Changes
</button>


</div>






<div className="settings-card">


<h2>
🎨 Appearance
</h2>


<div className="toggle-item">

Dark Mode

<button>
OFF
</button>

</div>




<div className="toggle-item">

Notifications

<button>
ON
</button>

</div>



</div>




</div>




</div>

)

}


export default Settings;