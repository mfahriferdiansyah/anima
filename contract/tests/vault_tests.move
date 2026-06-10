#[test_only]
module anima::vault_tests;

use anima::vault::{Self, Vault};
use sui::test_scenario as ts;
use sui::bcs;

const OWNER: address = @0xA11CE;
const AGENT: address = @0xA6E27;
const OUTSIDER: address = @0xBAD;

fun id_of(addr: address): vector<u8> { bcs::to_bytes(&addr) }

fun setup(): ts::Scenario {
    let mut scen = ts::begin(OWNER);
    vault::create_vault(b"Test Vault".to_string(), AGENT, scen.ctx());
    scen
}

#[test]
fun owner_passes_seal_approve() {
    let mut scen = setup();
    scen.next_tx(OWNER);
    let v = scen.take_shared<Vault>();
    vault::seal_approve(id_of(OWNER), &v, scen.ctx());
    ts::return_shared(v);
    scen.end();
}

#[test]
fun first_agent_registered_at_creation_passes() {
    let mut scen = setup();
    scen.next_tx(AGENT);
    let v = scen.take_shared<Vault>();
    assert!(vault::is_agent(&v, AGENT));
    vault::seal_approve(id_of(OWNER), &v, scen.ctx());
    ts::return_shared(v);
    scen.end();
}

#[test]
#[expected_failure(abort_code = vault::ENoAccess)]
fun outsider_denied() {
    let mut scen = setup();
    scen.next_tx(OUTSIDER);
    let v = scen.take_shared<Vault>();
    vault::seal_approve(id_of(OWNER), &v, scen.ctx());
    ts::return_shared(v);
    scen.end();
}

#[test]
#[expected_failure(abort_code = vault::ENoAccess)]
fun wrong_identity_denied_even_for_owner() {
    let mut scen = setup();
    scen.next_tx(OWNER);
    let v = scen.take_shared<Vault>();
    vault::seal_approve(id_of(OUTSIDER), &v, scen.ctx());
    ts::return_shared(v);
    scen.end();
}

#[test]
fun register_then_revoke_agent() {
    let mut scen = setup();
    scen.next_tx(OWNER);
    let mut v = scen.take_shared<Vault>();
    vault::register_agent(&mut v, OUTSIDER, scen.ctx());
    assert!(vault::is_agent(&v, OUTSIDER));
    vault::revoke_agent(&mut v, OUTSIDER, scen.ctx());
    assert!(!vault::is_agent(&v, OUTSIDER));
    ts::return_shared(v);
    scen.end();
}

#[test]
#[expected_failure(abort_code = vault::ENoAccess)]
fun revoked_agent_denied() {
    let mut scen = setup();
    scen.next_tx(OWNER);
    {
        let mut v = scen.take_shared<Vault>();
        vault::revoke_agent(&mut v, AGENT, scen.ctx());
        ts::return_shared(v);
    };
    scen.next_tx(AGENT);
    let v = scen.take_shared<Vault>();
    vault::seal_approve(id_of(OWNER), &v, scen.ctx());
    ts::return_shared(v);
    scen.end();
}

#[test]
#[expected_failure(abort_code = vault::ENotOwner)]
fun privilege_escalation_agent_cannot_register() {
    let mut scen = setup();
    scen.next_tx(AGENT);
    let mut v = scen.take_shared<Vault>();
    vault::register_agent(&mut v, OUTSIDER, scen.ctx());
    ts::return_shared(v);
    scen.end();
}

#[test]
#[expected_failure(abort_code = vault::ENotOwner)]
fun privilege_escalation_agent_cannot_revoke() {
    let mut scen = setup();
    scen.next_tx(AGENT);
    let mut v = scen.take_shared<Vault>();
    vault::revoke_agent(&mut v, AGENT, scen.ctx());
    ts::return_shared(v);
    scen.end();
}

#[test]
#[expected_failure]
fun duplicate_register_aborts() {
    let mut scen = setup();
    scen.next_tx(OWNER);
    let mut v = scen.take_shared<Vault>();
    vault::register_agent(&mut v, AGENT, scen.ctx()); // AGENT already registered at creation
    ts::return_shared(v);
    scen.end();
}
