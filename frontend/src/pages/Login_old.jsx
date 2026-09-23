import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AuthContext } from "../context/AuthContext";

import "../styles/auth.css";


function Login(){


const navigate = useNavigate();

const {login} = useContext(AuthContext);


const [email,setEmail] = useState("");

const [password,setPassword] = useState("");



const handleLogin = ()=>{


// temporary login (backend will replace this later)

login(email || "student");


navigate("/dashboard");


};



return(

<div className="login-page">


<div className="login-card">


<h1>
Welcome Back 👋
</h1>


<p>
Login to continue your learning journey
</p>




<input

type="email"

placeholder="Enter Email"

value={email}

onChange={(e)=>setEmail(e.target.value)}

/>





<input

type="password"

placeholder="Enter Password"

value={password}

onChange={(e)=>setPassword(e.target.value)}

/>





<button

onClick={handleLogin}

>

Login

</button>





<div className="register-link">

Don't have an account? Register

</div>



</div>


</div>

)

}


export default Login;