import ProfileForm from "../../components/forms/ProfileForm";

function EditProfile() {
  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
          Profile
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-950">
          Edit your profile
        </h2>
      </div>
      <ProfileForm />
    </div>
  );
}

export default EditProfile;
