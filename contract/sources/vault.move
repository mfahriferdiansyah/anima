/// ANIMA vault: owner + companion name + allowlist of agent keys.
/// Seal access policy: `seal_approve` passes when the requester is the owner
/// or a registered agent, and the identity bytes equal the owner address.
/// Key servers dry-run the PTB with sender = the session certificate's user.
module anima::vault;

use std::string::String;
use sui::vec_set::{Self, VecSet};
use sui::bcs;

const ENoAccess: u64 = 1;
const ENotOwner: u64 = 2;

public struct Vault has key {
    id: UID,
    owner: address,
    name: String,
    agents: VecSet<address>,
}

/// Create a shared vault owned by the sender. Returns the vault ID for PTB chaining.
public fun create_vault(name: String, ctx: &mut TxContext): ID {
    let vault = Vault {
        id: object::new(ctx),
        owner: ctx.sender(),
        name,
        agents: vec_set::empty(),
    };
    let id = object::id(&vault);
    transfer::share_object(vault);
    id
}

/// Owner-only. Aborts on duplicate registration (VecSet semantics).
public fun register_agent(vault: &mut Vault, agent: address, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    vault.agents.insert(agent);
}

/// Owner-only. Aborts if the agent is not registered.
public fun revoke_agent(vault: &mut Vault, agent: address, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    vault.agents.remove(&agent);
}

public fun owner(vault: &Vault): address { vault.owner }
public fun name(vault: &Vault): String { vault.name }
public fun is_agent(vault: &Vault, who: address): bool { vault.agents.contains(&who) }

/// Seal policy. `id` is the identity bytes (without the package prefix):
/// must equal bcs(owner). Requester must be owner or an allowlisted agent.
entry fun seal_approve(id: vector<u8>, vault: &Vault, ctx: &TxContext) {
    let sender = ctx.sender();
    assert!(id == bcs::to_bytes(&vault.owner), ENoAccess);
    assert!(sender == vault.owner || vault.agents.contains(&sender), ENoAccess);
}

#[test_only]
public fun destroy_for_testing(vault: Vault) {
    let Vault { id, owner: _, name: _, agents: _ } = vault;
    id.delete();
}
