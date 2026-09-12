import { WalletStatus } from "@/components/wallet-status";

export default function Home() {
  return (
    <main>
      <header>
        <div className="brand">
          Accountability <span className="badge">Devnet</span>
        </div>
        <WalletStatus />
      </header>
      <section className="intro">
        <p className="eyebrow">A little stake. A real commitment.</p>
        <h1>
          Put your SOL
          <br />
          where your word is.
        </h1>
        <p>Make a commitment, pick a judge, and let your group take a side.</p>
      </section>
      <div className="workspace">
        <section className="panel" aria-labelledby="create-title">
          <h2 id="create-title">Create a pot</h2>
          <p className="muted">Task, fixed stake, deadline, and judge.</p>
          <fieldset disabled aria-describedby="scaffold-note">
            <label>
              Task
              <input placeholder="What will you commit to?" maxLength={200} />
            </label>
            <div className="form-row">
              <label>
                Stake (SOL)
                <input
                  type="number"
                  placeholder="0.01"
                  min="0.000000001"
                  step="0.01"
                />
              </label>
              <label>
                Deadline
                <input type="datetime-local" />
              </label>
            </div>
            <label>
              Judge wallet
              <input placeholder="Solana wallet address" />
            </label>
            <button className="primary" type="button">
              Create pot
            </button>
          </fieldset>
          <p id="scaffold-note" className="note">
            Scaffold only. Pot creation, joining, and settlement are coming
            next.
          </p>
        </section>
        <section className="panel" aria-labelledby="pots-title">
          <h2 id="pots-title">Pots</h2>
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              ◎
            </span>
            <h3>Your commitments will live here.</h3>
            <p>
              Once pot instructions are connected, this page will show live
              on-chain pots and their outcomes.
            </p>
          </div>
        </section>
      </div>
      <footer>Solana devnet prototype · Uses test SOL</footer>
    </main>
  );
}
