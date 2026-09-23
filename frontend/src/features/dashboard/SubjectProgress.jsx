const subjects = [
  {
    name: "Python",
    progress: 90,
  },
  {
    name: "Artificial Intelligence",
    progress: 75,
  },
  {
    name: "DBMS",
    progress: 65,
  },
  {
    name: "React",
    progress: 85,
  },
];

const SubjectProgress = () => {
  return (
    <div className="widget">
      <h3>📚 Subject Progress</h3>

      {subjects.map((subject, index) => (
        <div key={index} className="subject">

          <div className="subject-header">
            <span>{subject.name}</span>
            <span>{subject.progress}%</span>
          </div>

          <div className="progress">
            <div
              className="progress-fill"
              style={{
                width: `${subject.progress}%`,
              }}
            ></div>
          </div>

        </div>
      ))}
    </div>
  );
};

export default SubjectProgress;