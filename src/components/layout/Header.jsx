const Header = ({ title, subtitle }) => {
  return (
    <div className="page-header">

      <h1>{title}</h1>

      <p>{subtitle}</p>

    </div>
  );
};

export default Header;