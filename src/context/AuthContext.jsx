import { createContext, useState } from "react";


export const AuthContext = createContext();



function AuthProvider({children}){


const [user,setUser] = useState(

localStorage.getItem("user")

);



const login = (email)=>{

localStorage.setItem(
"user",
email
);

setUser(email);

};



const logout = ()=>{

localStorage.removeItem("user");

setUser(null);

};



return(

<AuthContext.Provider

value={{
user,
login,
logout
}}

>

{children}

</AuthContext.Provider>

)

}


export default AuthProvider;