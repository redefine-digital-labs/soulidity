/// Delegates to the canonical MakerPublication validators.
module soulidity_application::publication_rules;
use soulidity_model::policy::{Definition,Adapter};
use soulidity_visual::visual::{Self,Scene};
use soulidity_maker_publication::publication_validation::{Self as canonical,Expected,AdapterKey};
public fun expected_assets(definitions:&vector<Definition>):(vector<Expected>,u64){ canonical::expected_assets(definitions) }
public fun expected_digest(r:&Expected):vector<u8>{ canonical::expected_digest(r) }
public fun expected_size(r:&Expected):u64{ canonical::expected_size(r) }
public fun expected_index(rows:&vector<Expected>,asset:vector<u8>):Option<u64>{ canonical::expected_index(rows,asset) }
public fun expected_lookup(rows:&vector<Expected>,asset:vector<u8>):Option<u64>{ canonical::expected_lookup(rows,asset) }
public fun validate(manifest:&vector<u8>,configuration:&vector<u8>,access_mode:u8,access_price:u64,completion_mode:u8,completion_price:u64,quota:u64,royalty_bps:u16,beneficiary:address,parts:&vector<vector<u8>>,required_parts:&vector<vector<u8>>,definitions:&vector<Definition>,adapters:&vector<Adapter>,scene:&Scene):u64{ canonical::validate(manifest,configuration,access_mode,access_price,completion_mode,completion_price,quota,royalty_bps,beneficiary,parts,required_parts,definitions,adapters,scene) }
public fun fragment_count(definitions:&vector<Definition>):u64{ canonical::fragment_count(definitions) }
public fun validate_added_definitions(parts:&vector<vector<u8>>,definitions:&vector<Definition>,extra:&vector<Definition>,scene:&Scene):u64{ canonical::validate_added_definitions(parts,definitions,extra,scene) }
public fun validate_added_adapters(parts:&vector<vector<u8>>,adapters:&vector<Adapter>,extra:&vector<Adapter>,scene:&Scene):u64{ canonical::validate_added_adapters(parts,adapters,extra,scene) }
public fun validate_outputs(outputs:&vector<soulidity_maker_publication::output_data::Policy>):u64{ canonical::validate_outputs(outputs) }
public fun validate_physical(definitions:&vector<Definition>,terms:&vector<soulidity_model::material_policy::Terms>):u64{ canonical::validate_physical(definitions,terms) }
public fun validate_binding(scene:&Scene,parts:&vector<vector<u8>>,required:&vector<vector<u8>>,definitions:&vector<Definition>,outputs:&vector<soulidity_maker_publication::output_data::Policy>,pack_key:&vector<u8>,rates:&soulidity_maker_terms::maker_resale::Rates,access_mode:u8,parent_scene:Option<Scene>,parent_paths:vector<visual::Selector>,prior_key:Option<vector<u8>>):u64{ canonical::validate_binding(scene,parts,required,definitions,outputs,pack_key,rates,access_mode,parent_scene,parent_paths,prior_key) }
