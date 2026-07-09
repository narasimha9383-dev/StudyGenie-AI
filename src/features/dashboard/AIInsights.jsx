import { BrainCircuit } from "lucide-react";

const AIInsights = () => {
  return (
    <div className="widget">

      <h3>🤖 AI Insights</h3>

      <div className="insight-card">

        <BrainCircuit size={45} color="#6C63FF"/>

        <div>

          <h4>Recommendation</h4>

          <p>
            Focus more on Data Structures today.
            Your consistency has dropped by 12%.
          </p>

        </div>

      </div>

    </div>
  );
};

export default AIInsights;